# Manual de crecimiento de la biblioteca LSC de VOZUAL

## Propósito

VOZUAL tiene dos responsabilidades distintas:

1. **Crear una seña reproducible en la app móvil.** Se guardan sus trayectorias: 33 puntos de pose, 21 puntos por mano y 468 puntos de cara por cuadro. La app reproduce esas trayectorias como un esqueleto.
2. **Aprender a reconocer palabras nuevas desde cámara.** Esto requiere un conjunto de ejemplos etiquetados, entrenamiento y pruebas. Publicar una seña no entrena por sí solo el modelo de reconocimiento.

La primera función ya está disponible en el editor. La segunda debe construirse sobre una biblioteca de capturas de buena calidad y correctamente segmentadas.

## Conceptos esenciales

- **Glosa:** nombre estable de una seña, por ejemplo `HOLA`, `YO`, `MAMA` o `GRACIAS`.
- **Clip aislado:** un archivo que contiene una sola seña, desde una posición neutral hasta volver a una posición neutral.
- **Segmento:** parte de un video largo que corresponde a una glosa concreta.
- **Landmarks:** coordenadas de cuerpo, manos y rostro que extrae MediaPipe; son el dato útil, no solo el MP4.
- **Publicar:** copiar la trayectoria aprobada al catálogo de la aplicación móvil. No equivale a entrenar el reconocedor.

## Regla de oro

Cada ejemplo de entrenamiento debe responder sin ambigüedad a esta pregunta:

> ¿Qué glosa hace la persona entre el segundo de inicio y el segundo de final?

Un video que contiene `HOLA`, pausa, `GRACIAS` y `YO` no puede etiquetarse simplemente como `HOLA`. Haría que el modelo aprenda que los movimientos de `GRACIAS` y `YO` también pertenecen a `HOLA`.

## Ruta recomendada: crear una palabra desde cero

Esta es la ruta más confiable para ampliar el vocabulario de la app.

1. Abra VOZUAL y escriba la glosa en mayúsculas, por ejemplo `ADIOS`.
2. Ubíquese de frente a la cámara, con hombros, codos, manos y rostro dentro del encuadre. Las manos no deben quedar fuera de la imagen.
3. Empiece con ambas manos abajo o en una postura neutral durante medio segundo.
4. Haga **una sola seña**, despacio y de forma natural. Incluya los movimientos de cara y boca si son parte de la seña.
5. Termine estable, idealmente regresando a una postura neutral durante medio segundo.
6. Pulse **Crear animación**. VOZUAL extrae y guarda las coordenadas de todos los cuadros.
7. Abra **Ver puntos detectados** y confirme:
   - rostro detectado durante la seña;
   - mano activa con 21 puntos;
   - hombro, codo y muñeca coherentes;
   - no hay saltos, manos duplicadas ni desapariciones largas.
8. Abra **Ver esqueleto capturado**. Debe seguir el mismo gesto que la persona, no el avatar 3D anterior.
9. Si es necesario, corrija parámetros y regenere; si la captura base es mala, grábela de nuevo.
10. Cuando esté aprobada, seleccione la seña en **Biblioteca de señas** y pulse **Publicar en app móvil**. El editor la incluirá en el catálogo publicado.
11. Elija compilar e instalar Android cuando VOZUAL lo pregunte. Solo después de esa instalación la nueva palabra estará disponible en el teléfono.

### Cuántos ejemplos capturar

Para la animación de la app, basta inicialmente con una toma aprobada. Para que el sistema **reconozca** una palabra nueva con fiabilidad, capture como mínimo:

| Etapa | Recomendación |
| --- | --- |
| Prototipo | 10 repeticiones de 3 personas distintas |
| Uso interno | 20--30 repeticiones de 8--10 personas |
| Robustez real | 50+ repeticiones, múltiples personas, fondos e iluminaciones |

Cada repetición debe conservar su glosa, persona señante, fecha, cámara, orientación y el inicio/fin del gesto.

## Uso de datos históricos

Sí se pueden aprovechar. No se deben usar directamente como si cada archivo tuviera una sola seña.

### Caso A: archivos ya aislados

Si cada MP4 contiene una única seña conocida, impórtelo como una nueva toma de esa glosa. Revise la detección y conserve el archivo original junto con los landmarks extraídos.

### Caso B: videos con varias señas

Primero se deben convertir en segmentos. Para cada seña se guarda un registro similar a este:

```text
video: entrevista_01.mp4
glosa: GRACIAS
inicio: 00:01:12.400
fin:    00:01:13.850
calidad: aprobada
```

Luego se recorta ese intervalo con un pequeño margen antes y después (por ejemplo 0,3--0,5 s) y se procesa como un clip aislado. Así un video largo puede producir muchos ejemplos limpios.

### Caso C: video largo sin transcripción ni tiempos

No es adecuado para entrenamiento automático todavía. Se puede usar para **preseleccionar** actividad de manos, pero una persona debe revisar y asignar:

- la glosa;
- inicio y final exactos;
- si hay transición entre dos señas;
- si el rostro y las manos son visibles;
- si el clip debe descartarse.

La automatización puede marcar zonas candidatas usando presencia de manos y energía de movimiento de muñeca/codo/dedos. No puede determinar de forma fiable qué palabra LSC es una zona desconocida sin un modelo entrenado y sin etiquetas.

## Cómo cortar correctamente un video largo

1. Mantenga el video original intacto.
2. Marque cada seña con inicio y final. No corte dentro del movimiento.
3. Añada contexto neutral corto antes y después; no añada una seña vecina.
4. Exporte un clip por glosa y repetición.
5. Ejecute VOZUAL sobre cada clip.
6. Rechace clips con manos ocultas, desenfoque, cambios de plano, dos personas, saltos de seguimiento o señal ambigua.
7. Guarde el resultado en un manifiesto de datos, no solo en nombres de archivo.

Ejemplo de manifestación mínima:

```json
{
  "clip": "gracias_s03_r07.mp4",
  "gloss": "GRACIAS",
  "signerId": "s03",
  "startSeconds": 0.0,
  "endSeconds": 1.45,
  "quality": "approved",
  "hasFace": true,
  "hasActiveHand": true
}
```

## Qué puede automatizar VOZUAL y qué no

| Tarea | Estado y límite |
| --- | --- |
| Detectar pose, manos y 468 puntos faciales | Automática, cuadro a cuadro |
| Extraer trayectoria y comprimir una toma lenta | Automática |
| Mostrar diagnóstico y esqueleto | Automática |
| Publicar una seña aprobada en la app | Automática, seguida de compilación/instalación |
| Detectar zonas con movimiento en video largo | Automatizable como ayuda |
| Nombrar correctamente una seña no etiquetada | Requiere etiqueta humana o un modelo ya entrenado |
| Distinguir señas muy parecidas | Requiere ejemplos positivos, ejemplos confundibles y evaluación |
| Aprender una palabra solo de una toma | No es fiable; sirve para animación, no para reconocimiento general |

## Flujo para que el sistema aprenda palabras nuevas

1. Defina la glosa y la variante LSC que se aceptará.
2. Reúna clips aislados aprobados de varios señantes.
3. Incluya ejemplos de palabras que se confunden con ella y ejemplos de no-seña/pausa.
4. Extraiga landmarks con VOZUAL/MediaPipe y almacene los manifiestos.
5. Divida los datos por persona señante: una misma persona no puede estar a la vez en entrenamiento y evaluación.
6. Entrene un clasificador de glosas sobre las secuencias, no sobre una imagen fija.
7. Mida precisión, errores de confusión y rechazo de palabra desconocida.
8. Solo si supera los criterios acordados, exporte el modelo para móvil y active la glosa en el reconocedor.
9. Mantenga la animación publicada separada del modelo: una seña puede verse bien en el teléfono aunque aún no sea reconocible de forma fiable.

## Criterio de aprobación antes de publicar

- Una sola seña por clip.
- Hombros, codos, muñecas y la mano activa detectados durante el gesto.
- Cara completa si la expresión facial es lingüísticamente relevante.
- Inicio y final sin salto de muñeca entre lados.
- El esqueleto reproduce la trayectoria observada.
- La glosa no sobrescribe otra publicada por accidente.
- La seña se prueba en Android después de compilar.

## Organización sugerida de la biblioteca

```text
dataset/
  raw/                 # Video original, nunca modificado
  segments/            # Un clip aislado por seña y repetición
  landmarks/           # Coordenadas extraídas por VOZUAL
  manifests/           # Metadatos, etiquetas y calidad
  rejected/            # Tomas que no deben entrar al entrenamiento
```

Use nombres previsibles, por ejemplo `YO_s03_r07.mp4`: glosa, persona señante y repetición. No use el MP4 generado del avatar como dato de entrenamiento; el dato de entrenamiento debe venir del video humano y sus landmarks.

## Decisión práctica

Para las próximas palabras, la forma más segura es: **una persona hace una seña aislada, VOZUAL extrae el esqueleto, una persona revisa y publica**. En paralelo, esas capturas se archivan como ejemplos etiquetados. Cuando haya suficientes ejemplos de varias personas, se entrena el reconocedor para que la app identifique también esas nuevas palabras al hablar o al ver señas.
