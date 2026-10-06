# Captura de gastos (Android + Google Sheets)

Push y SMS → app Android → Apps Script → hoja "Movimientos". Correos → Apps Script directo.
Los parsers viven en Apps Script: para ajustarlos no hay que recompilar la app.

## 1. Hoja y backend
1. Crea una Google Sheet → Extensiones → Apps Script → pega `apps-script/Code.gs`.
2. Cambia `CFG.TOKEN` por algo largo y aleatorio.
3. Ejecuta `setup()` y autoriza. Crea pestañas, reglas de categorías, etiqueta "Bancos" y un disparador cada 10 min.
4. Ejecuta `probarParsers()`: en el registro debe salir el cargo de HSBC por 1800 MXN.
5. Implementar → Nueva implementación → Aplicación web → Ejecutar como: yo; Acceso: cualquier usuario → copia la URL `/exec`.
   (Si luego cambias el código: Implementar → Gestionar → editar → Nueva versión, para conservar la misma URL.)

## 2. Gmail
Crea un filtro por remitente de los avisos de cada banco → "Aplicar etiqueta: Bancos".

## 3. App Android
1. Abre la carpeta en Android Studio (acepta generar el Gradle wrapper si lo pide) → Run en el S26 por USB, o Build → Build APK.
2. Si la instalación se bloquea: desactiva el Bloqueador automático (Ajustes → Seguridad y privacidad).
3. En la app: pega URL y token → Guardar → "Probar conexión" debe responder `conexión correcta`.
4. Botón 1 (notificaciones). Si sale atenuado: Ajustes → Apps → Gastos → ⋮ → Permitir ajustes restringidos, y repite.
5. Botón 2 (SMS) y botón 3 (batería: marca Gastos como "Sin restricciones").

## 4. Carpeta Segura / Espacio privado
Agrega la app dentro de ese espacio (Carpeta Segura → Agregar apps → Gastos) y repite el paso 3 ahí.
Cada copia escucha las apps de su espacio; el backend unifica y deduplica.

## 5. Ajuste fino
- Deja el modo descubrimiento activo unos días: los avisos de HSBC/Santander push u otras apps caen en "SinParsear" con su paquete.
  Copia los paquetes de bancos a la lista de la app y apaga el descubrimiento.
- Todo lo marcado "revisar" vino de un parser genérico o provisional; con ejemplos reales se cambia por uno específico.
- Categorías: edita la pestaña "Reglas" (regex → categoría).
