import { useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { fileToProfileDataUrl } from '../lib/image';

/** Only show real browser-loadable images (data URLs / http), not seed path stubs. */
function usablePhoto(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith('data:image/')) return src;
  if (/^https?:\/\//i.test(src) || src.startsWith('blob:')) return src;
  return null;
}

interface Props {
  src: string | null | undefined;
  name?: string;
  size?: 'md' | 'lg' | 'xl' | 'xxl';
  editable?: boolean;
  onChange?: (dataUrl: string | null) => void | Promise<void>;
}

export function ProfileAvatar({
  src,
  name = 'U',
  size = 'lg',
  editable = false,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [broken, setBroken] = useState(false);
  const photo = usablePhoto(src);
  const initial = (name.trim().charAt(0) || 'U').toUpperCase();
  const showPhoto = Boolean(photo) && !broken;

  async function onPick(file: File | undefined) {
    if (!file || !onChange) return;
    setErr('');
    setBusy(true);
    try {
      const dataUrl = await fileToProfileDataUrl(file);
      setBroken(false);
      await onChange(dataUrl);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={`profile-avatar-wrap size-${size}${editable ? ' editable' : ''}`}>
      <div className={`profile-avatar size-${size}${showPhoto ? ' has-photo' : ''}`}>
        {showPhoto ? (
          <img src={photo!} alt={name} onError={() => setBroken(true)} />
        ) : (
          <span>{initial}</span>
        )}
        {busy && <div className="avatar-busy" />}
      </div>
      {editable && (
        <div className="avatar-actions">
          <button
            type="button"
            className="avatar-action"
            title="Upload photo"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {showPhoto ? <Camera size={14} /> : <ImagePlus size={14} />}
          </button>
          {showPhoto && (
            <button
              type="button"
              className="avatar-action danger"
              title="Remove photo"
              disabled={busy}
              onClick={() => {
                setBroken(false);
                void onChange?.(null);
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      {err && <p className="avatar-err">{err}</p>}
    </div>
  );
}

/** Compact avatar for nav / lists */
export function UserAvatar({
  src,
  name = 'U',
  className = '',
}: {
  src?: string | null;
  name?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const photo = usablePhoto(src);
  const initial = (name.trim().charAt(0) || 'U').toUpperCase();
  const showPhoto = Boolean(photo) && !broken;
  return (
    <div className={`user-avatar ${className}${showPhoto ? ' has-photo' : ''}`}>
      {showPhoto ? (
        <img src={photo!} alt={name} onError={() => setBroken(true)} />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
