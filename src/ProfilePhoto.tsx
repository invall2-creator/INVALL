import { useEffect, useState, type ChangeEvent } from 'react';
import { supabase } from './lib/supabase';

const photos = supabase.storage.from('profile-photos');

async function preparePhoto(file: File): Promise<Blob> {
  if (file.size > 20 * 1024 * 1024) throw new Error('File too large');

  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();

    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(512, side);
    const context = canvas.getContext('2d');
    if (!context || !side) throw new Error('Invalid image');

    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2,
      side, side, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image conversion failed')), 'image/jpeg', 0.85);
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function ProfilePhoto({ userId, name }: { userId: string; name: string }) {
  const path = userId + '/avatar.jpg';
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toLocaleUpperCase('ca');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function readPhoto() {
      try {
        const { data: files, error: listError } = await photos.list(userId, { search: 'avatar.jpg' });
        if (listError) throw listError;
        if (!files.some(file => file.name === 'avatar.jpg')) return;
        const { data, error } = await photos.download(path, {}, { cache: 'no-store' });
        if (error) throw error;
        if (active) setPhoto(data);
      } catch {
        if (active) setMessage('No s’ha pogut carregar la foto de perfil.');
      } finally {
        if (active) setBusy(false);
      }
    }
    void readPhoto();
    return () => { active = false; };
  }, [path, userId]);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const image = await preparePhoto(file);
      const { error } = await photos.upload(path, image, { upsert: true, contentType: 'image/jpeg', cacheControl: '0' });
      if (error) throw error;
      setPhoto(image);
      setMessage('Foto de perfil desada.');
    } catch {
      setMessage('No s’ha pogut desar la foto. Prova amb una imatge JPG, PNG o WebP de fins a 20 MB.');
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    setMessage('');
    try {
      const { error } = await photos.remove([path]);
      if (error) throw error;
      setPhoto(null);
      setMessage('Foto de perfil eliminada.');
    } catch {
      setMessage('No s’ha pogut eliminar la foto de perfil.');
    } finally {
      setBusy(false);
    }
  }

  return <details className="profile-photo">
    <summary>
      {preview ? <img src={preview} alt="" /> : <span className="profile-initials" aria-hidden="true">{initials}</span>}
      <span>Foto de perfil</span>
    </summary>
    <div className="profile-photo-controls">
      <label>{photo ? 'Canvia la foto' : 'Tria una foto'}
        <input type="file" accept="image/*" disabled={busy} onChange={choosePhoto} />
      </label>
      {photo && <button type="button" disabled={busy} onClick={() => void removePhoto()}>Treu la foto</button>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
