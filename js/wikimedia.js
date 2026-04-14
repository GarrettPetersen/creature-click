const API = 'https://commons.wikimedia.org/w/api.php';

/**
 * @param {string} fileTitle — e.g. "Red Panda.JPG" or "File:Red Panda.JPG"
 * @returns {{ fullUrl: string, thumbUrl: string }}
 */
export async function fetchCreatureImage(fileTitle) {
  const title = fileTitle.startsWith('File:') ? fileTitle : `File:${fileTitle}`;
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error('Could not reach the photo library.');
  const data = await res.json();
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page || page.missing || !page.imageinfo?.[0]?.url) {
    throw new Error('That photo was not found.');
  }
  const info = page.imageinfo[0];
  return {
    fullUrl: info.url,
    thumbUrl: info.thumburl || info.url,
  };
}
