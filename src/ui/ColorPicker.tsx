import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { Icon, Button } from './common';
import { LogoMark, Wordmark } from './Logo';

export const ACCENT_SWATCHES = [
  { value: '#4cc2ff', label: 'Sky' },
  { value: '#3b82f6', label: 'Ocean' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#e04fd8', label: 'Magenta' },
  { value: '#ff5c8a', label: 'Rose' },
  { value: '#ff4d4d', label: 'Red' },
  { value: '#ff8a3d', label: 'Orange' },
  { value: '#ffb547', label: 'Amber' },
  { value: '#a3e635', label: 'Lime' },
  { value: '#3ddc97', label: 'Mint' },
  { value: '#2dd4bf', label: 'Teal' },
  { value: '#d4d8de', label: 'Silver' },
];

/** Remote-friendly accent color picker: a grid of swatches plus a custom hex value, with a live preview. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [custom, setCustom] = useState(value);
  const [err, setErr] = useState('');
  const known = ACCENT_SWATCHES.find((c) => c.value.toLowerCase() === value.toLowerCase());
  const applyCustom = () => {
    const v = custom.trim().startsWith('#') ? custom.trim() : '#' + custom.trim();
    if (!/^#[0-9a-f]{6}$/i.test(v)) {
      setErr('Use a 6-digit hex color like #4CC2FF');
      return;
    }
    setErr('');
    onChange(v.toLowerCase());
  };
  return (
    <div class="color-picker">
      <div class="color-preview" aria-hidden="true">
        <LogoMark size="4.4rem" />
        <Wordmark />
        <span class="color-preview-btn">Watch</span>
        <span class="color-preview-bar"><span /></span>
      </div>
      <div class="swatches" role="radiogroup" aria-label="Accent color" data-group="swatches">
        {ACCENT_SWATCHES.map((c) => {
          const on = c.value.toLowerCase() === value.toLowerCase();
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.label}
              title={c.label}
              class={`f swatch ${on ? 'on' : ''}`}
              style={{ '--sw': c.value } as unknown as string}
              onClick={() => {
                setCustom(c.value);
                onChange(c.value);
              }}
            >
              {on && <Icon name="check" size="1.4rem" />}
            </button>
          );
        })}
      </div>
      <div class="swatch-name muted">{known ? known.label : `Custom ${value.toUpperCase()}`}</div>
      <form
        class="row gap-sm custom-color"
        onSubmit={(e) => {
          e.preventDefault();
          applyCustom();
        }}
      >
        <span class="swatch small" style={{ '--sw': /^#?[0-9a-f]{6}$/i.test(custom.trim()) ? (custom.trim().startsWith('#') ? custom.trim() : '#' + custom.trim()) : 'transparent' } as unknown as string} />
        <input class="f input" value={custom} maxLength={7} spellcheck={false} aria-label="Custom color (hex)" placeholder="#4CC2FF" onInput={(e) => setCustom((e.target as HTMLInputElement).value)} />
        <Button small icon="check" onClick={applyCustom}>Use color</Button>
      </form>
      {err && <small class="error-text">{err}</small>}
    </div>
  );
}
