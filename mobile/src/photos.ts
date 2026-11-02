// Shrinking a picked photo to a small JPEG the database will take, as a data address. Your photo is a 160px
// square (at most 60,000 characters, set_photo in 0013); a cover photo is a 720x400 strip (at most 150,000, 0041).
import type * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

async function shrink(asset: ImagePicker.ImagePickerAsset, wide: boolean): Promise<string> {
  const w = asset.width, h = asset.height;
  if (!w || !h) throw new Error('empty');
  const ratio = wide ? 720 / 400 : 1;
  const cw = Math.min(w, h * ratio), ch = cw / ratio;
  const ref = await ImageManipulator.manipulate(asset.uri)
    .crop({ originX: Math.floor((w - cw) / 2), originY: Math.floor((h - ch) / 2), width: Math.floor(cw), height: Math.floor(ch) })
    .resize(wide ? { width: 720, height: 400 } : { width: 160, height: 160 })
    .renderAsync();
  const limit = wide ? 150000 : 60000;
  let out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
  let url = 'data:image/jpeg;base64,' + (out.base64 || '');
  for (const compress of [0.6, 0.4]) {
    if (url.length <= limit) break;
    out = await ref.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
    url = 'data:image/jpeg;base64,' + (out.base64 || '');
  }
  if (!out.base64 || url.length > limit) throw new Error('too big');
  return url;
}

export function shrinkPhoto(asset: ImagePicker.ImagePickerAsset): Promise<string> { return shrink(asset, false); }
export function shrinkCover(asset: ImagePicker.ImagePickerAsset): Promise<string> { return shrink(asset, true); }
