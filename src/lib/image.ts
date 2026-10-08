/** Shrink a phone photo before it leaves the phone: Lagos data is not free. */
export async function shrink(file: File, max = 1280): Promise<Blob> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("encode failed"))), "image/jpeg", 0.8));
}
