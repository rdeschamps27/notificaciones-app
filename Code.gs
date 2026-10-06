/**
 * Backend de captura de gastos.
 * Recibe push/SMS desde la app Android (doPost), lee correos de Gmail (scanGmail),
 * parsea, deduplica entre canales y escribe en la hoja "Movimientos".
 */

const CFG = {
  TOKEN: 'CAMBIA-ESTE-TOKEN-LARGO',  // pon algo largo y aleatorio; el mismo en la app
  GMAIL_LABEL: 'Bancos',             // etiqueta que le pone tu filtro de Gmail a los avisos
  DEDUP_MIN: 15,                     // ventana para fusionar el mismo cargo llegado por varios canales
};

const SH = { MOV: 'Movimientos', RAW: 'Crudo', NOPARSE: 'SinParsear', RULES: 'Reglas' };
const HEADERS = {
  Movimientos: ['id', 'fecha', 'monto', 'moneda', 'tipo', 'comercio', 'tarjeta', 'banco', 'categoria',
                'canales', 'parser', 'revisar', 'fecha_banco', 'texto'],
  Crudo:       ['recibido', 'hash', 'canal', 'origen', 'perfil', 'titulo', 'texto', 'resultado'],
  SinParsear:  ['recibido', 'canal', 'origen', 'titulo', 'texto', 'nota'],
  Reglas:      ['patron (regex)', 'categoria'],
};

/* ============================ Instalación ============================ */

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach(name => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(HEADERS[name]); sh.setFrozenRows(1); }
  });
  const rules = ss.getSheetByName(SH.RULES);
  if (rules.getLastRow() === 1) {
    rules.getRange(2, 1, 6, 2).setValues([
      ['OXXO|7-ELEVEN|7 ELEVEN', 'Conveniencia'],
      ['UBER|DIDI|CABIFY', 'Transporte'],
      ['\\bDRA?\\b|FARMACIA|HOSPITAL|LABORATORIO|CLINICA', 'Salud'],
      ['NETFLIX|SPOTIFY|DISNEY|GOOGLE \\*|APPLE\\.COM|AMAZON PRIME', 'Suscripciones'],
      ['WALMART|SORIANA|CHEDRAUI|COSTCO|HEB|LA COMER|SUPERAMA', 'Súper'],
      ['PEMEX|GASOLIN|OXXO GAS|SHELL|BP ', 'Gasolina'],
    ]);
  }
  if (!GmailApp.getUserLabelByName(CFG.GMAIL_LABEL)) GmailApp.createLabel(CFG.GMAIL_LABEL);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scanGmail')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scanGmail').timeBased().everyMinutes(10).create();
}

/* ============================ Entrada: app Android ============================ */

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== CFG.TOKEN) return json_({ ok: false, error: 'token inválido' });
    if (d.source === 'test') return json_({ ok: true, r: 'conexión correcta' });
    const r = ingest_({
      canal: d.source, origen: String(d.app || ''), perfil: String(d.profile || ''),
      titulo: String(d.title || ''), texto: String(d.text || ''),
      ts: new Date(Number(d.ts) || Date.now()), descubrimiento: !!d.discovery,
    });
    return json_({ ok: true, r: r });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================ Entrada: Gmail ============================ */

function scanGmail() {
  const threads = GmailApp.search('label:' + CFG.GMAIL_LABEL.replace(/[\/ ]/g, '-') + ' newer_than:2d', 0, 50);
  const limite = Date.now() - 2 * 864e5;
  threads.forEach(t => t.getMessages().forEach(m => {
    if (m.getDate().getTime() < limite) return;
    let body = m.getPlainBody() || m.getBody().replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    body = body.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
    // El hash del crudo hace que reprocesar el mismo correo no duplique nada.
    ingest_({ canal: 'email', origen: m.getFrom(), perfil: '', titulo: m.getSubject(), texto: body,
              ts: m.getDate(), descubrimiento: false });
  }));
}

/* ============================ Núcleo ============================ */

function ingest_(rec) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const raw = ss.getSheetByName(SH.RAW);
    const minuto = Math.floor(rec.ts.getTime() / 60000);
    const hash = sha_([rec.canal, rec.titulo, rec.texto, minuto].join('|'));
    if (raw.getLastRow() > 1 &&
        raw.getRange(2, 2, raw.getLastRow() - 1, 1).createTextFinder(hash).matchEntireCell(true).findNext()) {
      return 'duplicado';
    }

    let resultado;
    const p = rec.descubrimiento ? null : parse_(rec);
    if (!p) {
      ss.getSheetByName(SH.NOPARSE).appendRow([rec.ts, rec.canal, rec.origen, rec.titulo, rec.texto,
        rec.descubrimiento ? 'app no listada (descubrimiento)' : 'sin parser']);
      resultado = 'sin-parsear';
    } else {
      resultado = upsertMov_(ss, rec, p);
    }
    raw.appendRow([rec.ts, hash, rec.canal, rec.origen, rec.perfil, rec.titulo, rec.texto, resultado]);
    return resultado;
  } finally {
    lock.releaseLock();
  }
}

function canalKey_(rec) {
  if (rec.canal === 'email') return 'email:' + (String(rec.origen).match(/@([\w.-]+)/) || [, rec.origen])[1];
  return rec.canal + ':' + rec.origen;
}

/** Inserta, o fusiona si el mismo cargo ya llegó por OTRO canal dentro de la ventana. */
function upsertMov_(ss, rec, p) {
  const sh = ss.getSheetByName(SH.MOV);
  const canal = canalKey_(rec);
  const last = sh.getLastRow();
  const W = HEADERS.Movimientos.length;

  if (last > 1) {
    const start = Math.max(2, last - 199);
    const rows = sh.getRange(start, 1, last - start + 1, W).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const dtMin = Math.abs(new Date(r[1]).getTime() - rec.ts.getTime()) / 60000;
      if (dtMin > CFG.DEDUP_MIN) continue;
      if (Number(r[2]) !== p.monto || r[3] !== p.moneda) continue;
      const canales = String(r[9]).split(', ');
      if (canales.indexOf(canal) >= 0) continue;            // mismo canal ⇒ es otro cargo real
      const bancoFila = String(r[7]);
      const esWallet = bancoFila === 'Google Wallet' || p.banco === 'Google Wallet';
      if (!esWallet && bancoFila && p.banco && bancoFila !== p.banco) continue;
      if (!esWallet && r[6] && p.tarjeta && String(r[6]) !== p.tarjeta) continue;

      const row = start + i;
      sh.getRange(row, 10).setValue(canales.concat(canal).join(', '));
      if (!r[5] && p.comercio) sh.getRange(row, 6).setValue(p.comercio);
      if (!r[6] && p.tarjeta) sh.getRange(row, 7).setValue("'" + p.tarjeta);
      if ((bancoFila === 'Google Wallet' || !bancoFila) && p.banco !== 'Google Wallet') {
        sh.getRange(row, 8).setValue(p.banco);               // el banco es mejor dato que la billetera
        if (r[11] && !p.revisar) sh.getRange(row, 12).setValue('');
      }
      return 'fusionado';
    }
  }

  sh.appendRow([
    Utilities.getUuid().slice(0, 8), rec.ts, p.monto, p.moneda, p.tipo, p.comercio || '',
    p.tarjeta ? "'" + p.tarjeta : '', p.banco, categorize_(ss, (p.comercio || '') + ' ' + rec.texto),
    canal, p.parser, p.revisar ? 'sí' : '', p.fechaBanco ? "'" + p.fechaBanco : '',
    (rec.titulo + ' ' + rec.texto).trim().slice(0, 500),
  ]);
  return 'nuevo';
}

function categorize_(ss, texto) {
  const sh = ss.getSheetByName(SH.RULES);
  if (sh.getLastRow() < 2) return '';
  const reglas = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (const [patron, cat] of reglas) {
    if (!patron) continue;
    try { if (new RegExp(patron, 'i').test(texto)) return cat; } catch (e) { /* regex inválida */ }
  }
  return '';
}

function sha_(s) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)).slice(0, 22);
}

/* ============================ Parsers ============================ */

function moneda_(s) {
  s = String(s || 'MXN').toUpperCase().replace(/\./g, '');
  return ({ MN: 'MXN', DLLS: 'USD', DLS: 'USD' })[s] || s;
}

function amount_(s) {
  let m = s.match(/([$€£])\s?(\d[\d.,]*)\s*(M\.?N\.?|MXN|USD|DLLS|EUR)?/i), num, cur;
  if (m) { num = m[2]; cur = m[3] || ({ '€': 'EUR', '£': 'GBP' })[m[1]] || 'MXN'; }
  else {
    m = s.match(/(\d[\d.,]*)\s?(MXN|USD|EUR)\b/i);
    if (!m) return null;
    num = m[1]; cur = m[2];
  }
  num = num.replace(/[.,]$/, '');
  const v = /,\d{1,2}$/.test(num) ? Number(num.replace(/\./g, '').replace(',', '.'))
                                  : Number(num.replace(/,/g, ''));
  return isFinite(v) && v > 0 ? { monto: Math.round(v * 100) / 100, moneda: moneda_(cur) } : null;
}

function last4_(s) {
  const m = s.match(/(?:terminaci[oó]n|terminada en|termina en|final(?:iza)? en|[*•·x]{2,})\s*(\d{4})\b/i);
  return m ? m[1] : '';
}

function tipo_(s) {
  if (/(recib|abono|dep[oó]sit|te (envi|transfiri)|reembolso|devoluci|bonificaci)/i.test(s)) return 'abono';
  if (/(compra|cargo|pag(o|aste|ó)|retiro|retiraste|transferiste|enviaste|domiciliaci|you paid|spent)/i.test(s)) return 'cargo';
  return null;
}

function banco_(rec) {
  const s = rec.origen + ' ' + rec.titulo + ' ' + rec.texto;
  if (/walletnfcrel/i.test(rec.origen)) return 'Google Wallet';
  if (/hsbc/i.test(s)) return 'HSBC';
  if (/santander/i.test(s)) return 'Santander';
  if (/revolut/i.test(s)) return 'Revolut';
  if (/com\.nu\.|@nu\.com|\bNu\b|nubank/i.test(s)) return 'Nu';
  return null;
}

const PARSERS = [
  {
    // Ej.: "HSBC: Realizo compra el 02/10/2026 en DRA THANIA CASTRO     CIU por $1800 MN con su Tarjeta terminacion 9082."
    name: 'hsbc-sms',
    test: rec => /^\s*HSBC:/i.test(rec.texto),
    parse: rec => {
      const m = rec.texto.match(/Realiz[oó]\s+(compra|retiro|cargo|pago)\s+el\s+(\d{2}\/\d{2}\/\d{4})\s+en\s+(.+?)\s+por\s+\$\s?([\d,]+(?:\.\d{1,2})?)\s*(M\.?N\.?|USD|DLLS)?\s+con\s+su\s+Tarjeta\s+terminaci[oó]n\s+(\d{4})/i);
      if (!m) return null;
      const partes = m[3].trim().split(/\s{2,}/);         // HSBC separa comercio y ciudad con varios espacios
      return {
        monto: Number(m[4].replace(/,/g, '')), moneda: moneda_(m[5]), tipo: 'cargo',
        comercio: partes[0], tarjeta: m[6], fechaBanco: m[2], banco: 'HSBC',
      };
    },
  },
  {
    // Formato aún por confirmar con un ejemplo real: queda marcado "revisar".
    name: 'google-wallet',
    test: rec => rec.origen === 'com.google.android.apps.walletnfcrel',
    parse: rec => {
      const a = amount_(rec.texto) || amount_(rec.titulo);
      if (!a) return null;
      return Object.assign(a, { tipo: 'cargo', comercio: rec.titulo, tarjeta: last4_(rec.texto + ' ' + rec.titulo),
                                banco: 'Google Wallet', revisar: true });
    },
  },
  {
    // Respaldo para bancos sin parser propio: exige banco reconocido + verbo de movimiento + monto.
    name: 'generico',
    test: rec => !!banco_(rec),
    parse: rec => {
      const s = (rec.titulo + ' ' + rec.texto).replace(/\s+/g, ' ');
      const a = amount_(s), tipo = tipo_(s);
      if (!a || !tipo) return null;
      const cm = s.match(/\b(?:en|at|a)\s+([A-Z0-9][A-Za-z0-9 .*&'\-]{2,40}?)(?=\s+(?:por|con|el|de|from|on|\$)|[.,]|$)/);
      return Object.assign(a, { tipo: tipo, comercio: cm ? cm[1].trim() : '', tarjeta: last4_(s),
                                banco: banco_(rec), revisar: true });
    },
  },
];

function parse_(rec) {
  for (const P of PARSERS) {
    if (!P.test(rec)) continue;
    const r = P.parse(rec);
    if (r) { r.parser = P.name; return r; }
  }
  return null;
}

/* ============================ Prueba manual ============================ */

function probarParsers() {
  const ej = {
    canal: 'sms', origen: '4722', titulo: '',
    texto: 'HSBC: Realizo compra el 02/10/2026 en DRA THANIA CASTRO     CIU por $1800 MN con su Tarjeta terminacion 9082. Gracias por usar su Tarjeta HSBC',
  };
  Logger.log(JSON.stringify(parse_(ej)));
}
