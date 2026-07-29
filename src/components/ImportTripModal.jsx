import { useState, useMemo, useRef } from 'react';
import { X, Upload, FileJson, Sparkles, AlertCircle, CheckCircle2, Merge, Replace } from 'lucide-react';
import {
  validateTrip, importToInternal, summarizeContract,
  haversineMeters, namesSimilar,
} from '../lib/tripSchema';
import { EXAMPLE_TRIP } from '../lib/exampleTrip';
import { toast } from '../lib/toast';

// Modal de importación de la investigación (JSON del contrato).
// Flujo: pegar / subir / cargar ejemplo -> validar -> resumen -> fusionar o reemplazar.
export default function ImportTripModal({ tripId, trip, importTripData, onClose }) {
  const [rawText, setRawText] = useState('');
  const [step, setStep] = useState('input'); // input | confirm | done
  const [validation, setValidation] = useState(null); // { ok, errors, data }
  const [dedupe, setDedupe] = useState('skip'); // skip | both
  const [doneMsg, setDoneMsg] = useState('');
  const fileRef = useRef(null);

  const parsed = validation?.data || null;
  const summary = useMemo(() => (parsed ? summarizeContract(parsed) : null), [parsed]);

  // Nº de lugares importados que coinciden con alguno ya existente (para avisar del dedupe).
  const duplicateCount = useMemo(() => {
    if (!parsed || !trip) return 0;
    const internal = importToInternal({ ...parsed, version: 1 });
    let n = 0;
    internal.pois.forEach(np => {
      if ((trip.pois || []).some(ep => haversineMeters(ep, np) < 200 && namesSimilar(ep.name, np.name))) n++;
    });
    return n;
  }, [parsed, trip]);

  const runValidation = (text) => {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      setValidation({ ok: false, errors: ['El texto no es JSON válido. Revisa que lo pegaste completo.'], data: null });
      setStep('confirm');
      return;
    }
    const result = validateTrip(json);
    setValidation(result);
    setStep('confirm');
  };

  const handleValidatePasted = () => {
    if (!rawText.trim()) return toast('Pega el JSON de la investigación o sube un archivo.', 'info');
    runValidation(rawText);
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRawText(String(reader.result || ''));
      runValidation(String(reader.result || ''));
    };
    reader.readAsText(file);
  };

  const handleLoadExample = () => {
    const text = JSON.stringify(EXAMPLE_TRIP, null, 2);
    setRawText(text);
    runValidation(text);
  };

  const doImport = (mode) => {
    const internal = importToInternal({ ...parsed, version: 1 });
    importTripData(tripId, internal, { mode, dedupe });
    const s = summarizeContract(parsed);
    setDoneMsg(
      mode === 'replace'
        ? `Viaje reemplazado con ${s.lugares} lugares, ${s.eventos} eventos y ${s.secciones} secciones de guía.`
        : `Añadidos ${s.lugares} lugares, ${s.eventos} eventos y ${s.secciones} secciones. ${dedupe === 'skip' && duplicateCount > 0 ? `Se omitieron ${duplicateCount} duplicados.` : ''}`
    );
    setStep('done');
    toast('Investigación importada.', 'success');
  };

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <h2 className="text-subtitle">Importar investigación</h2>
            <p className="text-caption text-secondary" style={{ marginTop: '2px' }}>
              Pega el JSON, sube un archivo o prueba con el ejemplo
            </p>
          </div>
          <button onClick={onClose} className="modal-close"><X size={22} /></button>
        </div>

        {/* ===== PASO 1: ENTRADA ===== */}
        {step === 'input' && (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-md)' }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
                <Upload size={16} /> Subir .json
              </button>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={handleLoadExample}>
                <Sparkles size={16} /> Cargar ejemplo
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleFile} style={{ display: 'none' }} />
            </div>

            <label className="field-label" style={{ marginBottom: '4px', display: 'block' }}>
              O pega aquí el JSON
            </label>
            <textarea
              className="input-field"
              rows={10}
              style={{ padding: '14px', resize: 'vertical', fontFamily: 'monospace', fontSize: '13px' }}
              placeholder={'{\n  "version": 1,\n  "destino": "Provincia de Cádiz",\n  "lugares": [ ... ]\n}'}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
            />

            <button
              className="btn btn-accent btn-full"
              style={{ marginTop: 'var(--space-md)' }}
              onClick={handleValidatePasted}
              disabled={!rawText.trim()}
            >
              Revisar antes de importar
            </button>
          </>
        )}

        {/* ===== PASO 2: CONFIRMACIÓN ===== */}
        {step === 'confirm' && validation && (
          <>
            {!validation.ok ? (
              <div className="card" style={{ borderLeft: '3px solid var(--color-danger)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--color-danger)' }}>
                  <AlertCircle size={18} />
                  <span style={{ fontWeight: 800 }}>El archivo no encaja con el esquema</span>
                </div>
                <ul style={{ paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {validation.errors.map((err, i) => (
                    <li key={i} className="text-caption text-secondary">{err}</li>
                  ))}
                </ul>
                <button className="btn btn-outline btn-full" style={{ marginTop: 'var(--space-md)' }} onClick={() => setStep('input')}>
                  Volver a intentarlo
                </button>
              </div>
            ) : (
              <>
                {/* Resumen de lo que se va a añadir */}
                <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                  <p className="text-caption text-secondary" style={{ marginBottom: '10px' }}>
                    {parsed.destino ? <>Investigación de <strong>{parsed.destino}</strong>. </> : null}Se va a añadir:
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <SummaryChip n={summary.lugares} label="lugares" />
                    <SummaryChip n={summary.bases} label="bases (alojamientos)" />
                    <SummaryChip n={summary.eventos} label="eventos" />
                    <SummaryChip n={summary.gastronomia} label="sitios de comer" />
                    <SummaryChip n={summary.secciones} label="secciones de guía" />
                    <SummaryChip n={summary.itinerarios} label="días de itinerario" />
                  </div>
                </div>

                {/* Aviso de duplicados y política de fusión */}
                {duplicateCount > 0 && (
                  <div className="card" style={{ marginBottom: 'var(--space-md)', borderLeft: '3px solid var(--color-gold)' }}>
                    <p className="text-caption" style={{ fontWeight: 700, marginBottom: '8px' }}>
                      {duplicateCount} lugar{duplicateCount !== 1 ? 'es' : ''} ya parece{duplicateCount !== 1 ? 'n' : ''} estar en el viaje
                      (mismo sitio a &lt;200 m).
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <RadioRow checked={dedupe === 'skip'} onClick={() => setDedupe('skip')}
                        title="Omitir los duplicados" desc="Mantén lo que ya tienes; no dupliques." />
                      <RadioRow checked={dedupe === 'both'} onClick={() => setDedupe('both')}
                        title="Añadirlos igualmente" desc="Se crearán entradas repetidas." />
                    </div>
                  </div>
                )}

                {/* Fusionar o reemplazar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button className="btn btn-primary btn-full" onClick={() => doImport('merge')}>
                    <Merge size={18} /> Fusionar con este viaje
                  </button>
                  <button className="btn btn-outline btn-full" onClick={() => doImport('replace')}>
                    <Replace size={18} /> Reemplazar todo el viaje
                  </button>
                  <button className="text-caption text-secondary" style={{ marginTop: '4px' }} onClick={() => setStep('input')}>
                    ← Volver a la entrada
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ===== PASO 3: HECHO ===== */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-lg) 0' }}>
            <CheckCircle2 size={44} style={{ color: 'var(--color-accent)', margin: '0 auto 12px' }} />
            <h3 className="text-subtitle" style={{ marginBottom: '8px' }}>Investigación importada</h3>
            <p className="text-body text-secondary" style={{ marginBottom: 'var(--space-lg)' }}>{doneMsg}</p>
            <button className="btn btn-primary btn-full" onClick={onClose}>Ver el viaje</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryChip({ n, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
      <FileJson size={14} style={{ color: 'var(--color-primary)', flexShrink: 0, alignSelf: 'center' }} />
      <span style={{ fontWeight: 800, fontSize: '16px', color: n > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{n}</span>
      <span className="text-caption text-secondary">{label}</span>
    </div>
  );
}

function RadioRow({ checked, onClick, title, desc }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: '2px',
        border: checked ? '5px solid var(--color-primary)' : '2px solid var(--text-tertiary)',
      }} />
      <div>
        <div style={{ fontWeight: 700, fontSize: '13px' }}>{title}</div>
        <div className="text-caption text-secondary">{desc}</div>
      </div>
    </button>
  );
}
