import { describe, expect, it } from 'vitest';

import { licenseNoteOf, parseFontFaceCss, planAdoption } from './adopt';
import type { FontSeal } from './types';

// Rút từ projects/maimoney/styles/fonts.css (repo gói không nằm trong CI).
const CSS = `/* Font của MaiMoney ---------------------------------------------------------
   SF Pro Display: chủ dự án đã chọn ship font để trang khớp Figma (quyết định
   PHÁP LÝ 08/09/2026).
   -------------------------------------------------------------------------- */

@font-face {
  font-family: "SF Pro Display";
  src: url("/p/fonts/sf-pro-display-regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "SF Pro Display";
  src: url("/p/fonts/sf-pro-display-medium.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "SF Pro Display";
  src: url("/p/fonts/sf-pro-display-semibold.woff2") format("woff2");
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "SF Pro Display";
  src: url("/p/fonts/sf-pro-display-bold.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: newYork;
  src: url("/p/fonts/newyork-regular.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: newYork;
  src: url("/p/fonts/newyork-italic.ttf") format("truetype");
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}
@font-face {
  font-family: gilroy;
  src: url("/p/fonts/gilroy-light.otf") format("opentype");
  font-weight: 300;
  font-display: swap;
}
@font-face {
  font-family: gilroy;
  src: url("/p/fonts/gilroy-regular.otf") format("opentype");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: gilroy;
  src: url("/p/fonts/gilroy-medium.otf") format("opentype");
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: gilroy;
  src: url("/p/fonts/gilroy-semibold.otf") format("opentype");
  font-weight: 600;
  font-display: swap;
}
@font-face {
  font-family: gilroy;
  src: url("/p/fonts/gilroy-bold.otf") format("opentype");
  font-weight: 700;
  font-display: swap;
}

:root {
  --font-display: "SF Pro Display", -apple-system, system-ui, "Inter", sans-serif;
  --font-body: "SF Pro Text", "SF Pro Display", sans-serif;
}
`;

describe('parseFontFaceCss', () => {
  const faces = parseFontFaceCss(CSS, 'maimoney');

  it('ra 11 face, 3 họ, bỏ qua khối :root', () => {
    expect(faces).toHaveLength(11);
    const count = (name: string) => faces.filter((f) => f.family === name).length;
    expect(count('SF Pro Display')).toBe(4);
    expect(count('newYork')).toBe(2);
    expect(count('gilroy')).toBe(5);
    expect(new Set(faces.map((f) => f.family)).size).toBe(3);
  });

  it('đổi /p/<x> thành đường file trong gói', () => {
    const light = faces.find((f) => f.url === '/p/fonts/gilroy-light.otf');
    expect(light?.file).toBe('projects/maimoney/public/fonts/gilroy-light.otf');
  });

  it('thiếu weight/style thì mặc định 400/normal; italic được giữ', () => {
    const italic = faces.find((f) => f.url.endsWith('newyork-italic.ttf'));
    expect(italic).toMatchObject({ weight: '400', style: 'italic' });
    const light = faces.find((f) => f.url.endsWith('gilroy-light.otf'));
    expect(light).toMatchObject({ weight: '300', style: 'normal', unicodeRange: '' });
  });

  it('đọc unicode-range và tên họ không nháy', () => {
    const [f] = parseFontFaceCss(
      '@font-face{font-family:Foo Bar;src:url(/p/fonts/a.woff2);unicode-range:U+0000-00FF,U+0131;}',
      'x',
    );
    expect(f).toMatchObject({ family: 'Foo Bar', unicodeRange: 'U+0000-00FF,U+0131', weight: '400' });
  });
});

describe('licenseNoteOf', () => {
  it('lấy comment đầu, gọn một dòng, tối đa 300 ký tự', () => {
    const note = licenseNoteOf(CSS);
    expect(note).toContain('quyết định');
    expect(note).not.toContain('----');
    expect(note).not.toMatch(/\s{2,}/);
    expect(note.length).toBeLessThanOrEqual(300);
    expect(licenseNoteOf('/* ' + 'a '.repeat(400) + '*/').length).toBeLessThanOrEqual(300);
    expect(licenseNoteOf('@font-face{}')).toBe('');
  });
});

describe('planAdoption', () => {
  const faces = parseFontFaceCss(CSS, 'maimoney');
  const shaOf = (file: string) => `${file.length.toString(16).padStart(2, '0')}${file.replace(/\W/g, '')}`.padEnd(8, '0');
  const empty: FontSeal = { families: [] };

  it('họ chưa có thì create, slug đúng', () => {
    const plan = planAdoption(faces, empty, shaOf, new Map());
    expect(plan.map((p) => [p.family, p.slug, p.action, p.faces.length])).toEqual([
      ['SF Pro Display', 'sf-pro-display', 'create', 4],
      ['newYork', 'newyork', 'create', 2],
      ['gilroy', 'gilroy', 'create', 5],
    ]);
  });

  it('chạy lại khi đã có đủ sha thì cả ba đều skip', () => {
    const plan0 = planAdoption(faces, empty, shaOf, new Map());
    const seal: FontSeal = {
      families: plan0.map((p) => ({ slug: p.slug, cssName: p.family, faces: [] })),
    };
    const shas = new Map(plan0.map((p) => [p.slug, new Set(p.faces.map((f) => shaOf(f.file)))]));
    const plan = planAdoption(faces, seal, shaOf, shas);
    expect(plan.map((p) => p.action)).toEqual(['skip', 'skip', 'skip']);
  });

  it('thiếu một face thì create chỉ với face còn thiếu', () => {
    const plan0 = planAdoption(faces, empty, shaOf, new Map());
    const seal: FontSeal = { families: [{ slug: 'gilroy', cssName: 'gilroy', faces: [] }] };
    const gilroy = plan0.find((p) => p.slug === 'gilroy')!;
    const have = new Set(gilroy.faces.slice(1).map((f) => shaOf(f.file)));
    const plan = planAdoption(faces, seal, shaOf, new Map([['gilroy', have]]));
    const g = plan.find((p) => p.slug === 'gilroy')!;
    expect(g.action).toBe('create');
    expect(g.faces).toHaveLength(1);
    expect(g.faces[0]?.url).toBe('/p/fonts/gilroy-light.otf');
  });
});
