-- Almacén único del viaje: nuevas columnas jsonb en `trips`.
--
-- Añade el soporte para eventos, gastronomía, logística, secciones de guía e
-- itinerarios (estos últimos hasta ahora NO se persistían). Los nuevos campos de
-- cada lugar (imprescindible, ya_visitado, descartado, duracion_estimada_min,
-- mejor_momento, notas, municipio, fuente) viajan dentro del jsonb `pois` existente,
-- por lo que no necesitan columna propia.
--
-- Idempotente: se puede ejecutar varias veces sin efecto adverso.
-- Cómo aplicar: Supabase → SQL Editor → pegar y ejecutar (o `supabase db push`).

alter table public.trips
  add column if not exists eventos        jsonb not null default '[]'::jsonb,
  add column if not exists gastronomia    jsonb not null default '[]'::jsonb,
  add column if not exists logistica      jsonb not null default '{}'::jsonb,
  add column if not exists secciones_guia jsonb not null default '[]'::jsonb,
  add column if not exists itinerarios    jsonb not null default '[]'::jsonb;
