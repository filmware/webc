// import { GLASBEY } from '@/constants/colors';

import { isString, percentString } from './data';
import md5 from './md5';

const HEX = '[0-9a-f]';
const NUM = '-?\\d+\\.?\\d*';
const REGEX_HEX = new RegExp(`^#?(${HEX}{2})(${HEX}{2})(${HEX}{2})(${HEX}{2})?$`, 'i');
const REGEX_HSL = new RegExp(
  `^hsl\\((${NUM})(deg|grad|rad|turn)?\\s+(${NUM})%\\s+(${NUM})%(\\s*\\/\\s*(${NUM})(%)?)?\\)$`,
  'i',
);
const REGEX_RGBA = new RegExp(
  `^rgba?\\((${NUM})\\s+(${NUM})\\s+(${NUM})(\\s*\\/\\s*(${NUM})(%)?)?\\)$`,
  'i',
);

export class HslColor {
  /**
   * h (hue) => 0.0 ~ 1.0
   * s (saturation) => 0.0 ~ 1.0
   * l (lightness) => 0.0 ~ 1.0
   * a (alpha) => 0.0 ~ 1.0
   */
  #h: number = 0;
  #s: number = 0.0;
  #l: number = 0.0;
  #a: number = 1.0;

  constructor(h: number, s: number, l: number, a = 1.0) {
    this.h = h;
    this.s = s;
    this.l = l;
    this.a = a;
  }

  set h(h: number) {
    this.#h = Math.max(0.0, Math.min(1.0, h));
  }

  set s(s: number) {
    this.#s = Math.max(0.0, Math.min(1.0, s));
  }

  set l(l: number) {
    this.#l = Math.max(0.0, Math.min(1.0, l));
  }

  set a(a: number) {
    this.#a = Math.max(0.0, Math.min(1.0, a));
  }

  get h(): number {
    return this.#h;
  }
  get s(): number {
    return this.#s;
  }
  get l(): number {
    return this.#l;
  }
  get a(): number {
    return this.#a;
  }

  toString(): string {
    return `hsl(${Math.round(this.#h * 360)}deg ${percentString(this.#s)} ${percentString(
      this.#l,
    )} / ${this.a})`;
  }
}

export class RgbaColor {
  /**
   * r (red) => 0.0 ~ 1.0
   * g (green) => 0.0 ~ 1.0
   * b (blue) => 0.0 ~ 1.0
   * a (alpha) => 0.0 ~ 1.0
   */
  #r: number = 0;
  #g: number = 0;
  #b: number = 0;
  #a: number = 1.0;

  constructor(r: number, g: number, b: number, a = 1.0) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  set r(r: number) {
    this.#r = Math.max(0.0, Math.min(1.0, r));
  }

  set g(g: number) {
    this.#g = Math.max(0.0, Math.min(1.0, g));
  }

  set b(b: number) {
    this.#b = Math.max(0.0, Math.min(1.0, b));
  }

  set a(a: number) {
    this.#a = Math.max(0.0, Math.min(1.0, a));
  }

  get r(): number {
    return this.#r;
  }
  get g(): number {
    return this.#g;
  }
  get b(): number {
    return this.#b;
  }
  get a(): number {
    return this.#a;
  }

  toString(): string {
    return `rgba(${Math.round(this.#r * 255)} ${Math.round(this.#g * 255)} ${Math.round(
      this.#b * 255,
    )} / ${this.#a})`;
  }
}

class Color {
  #rgba: RgbaColor;

  constructor(hex: string);
  constructor(hsl: string | HslColor);
  constructor(rgba: string | RgbaColor);
  constructor(arg: string | HslColor | RgbaColor) {
    this.#rgba = new RgbaColor(0, 0, 0);

    if (isString(arg)) {
      if (REGEX_HEX.test(arg)) {
        this.#rgba = this.hexToRgba(arg);
      } else if (REGEX_HSL.test(arg)) {
        this.#rgba = this.hslToRgba(this.stringToHsl(arg));
      } else if (REGEX_RGBA.test(arg)) {
        this.#rgba = this.stringToRgba(arg);
      }
    } else if (arg instanceof HslColor) {
      this.#rgba = this.hslToRgba(arg);
    } else if (arg instanceof RgbaColor) {
      this.#rgba = arg;
    }
  }

  get hex(): string {
    return this.rgbaToHex(this.#rgba);
  }
  get hsl(): HslColor {
    return this.rgbaToHsl(this.#rgba);
  }
  get rgba(): RgbaColor {
    return this.#rgba;
  }

  /**
   * Converters
   */

  hexToRgba(hex: string): RgbaColor {
    const rgba = new RgbaColor(0, 0, 0);
    const matches = hex.match(REGEX_HEX);
    if (matches?.length !== 5) return rgba;

    rgba.r = parseInt(matches[1], 16) / 255;
    rgba.g = parseInt(matches[2], 16) / 255;
    rgba.b = parseInt(matches[3], 16) / 255;
    if (matches[4]) rgba.a = parseInt(matches[4], 16) / 255;

    return rgba;
  }

  hslToRgba(hsl: HslColor): RgbaColor {
    const { h, s, l, a } = hsl;
    let [r, g, b] = [0, 0, 0];

    if (s === 0) {
      r = g = b = l; // Achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = this.hueToRgb(p, q, h + 1 / 3);
      g = this.hueToRgb(p, q, h);
      b = this.hueToRgb(p, q, h - 1 / 3);
    }

    return new RgbaColor(r, g, b, a);
  }

  hueToRgb(p: number, q: number, t: number) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  rgbaToHex(rgba: RgbaColor): string {
    const r = Math.round(rgba.r * 255).toString(16);
    const g = Math.round(rgba.g * 255).toString(16);
    const b = Math.round(rgba.b * 255).toString(16);
    const a = Math.round(rgba.a * 255).toString(16);
    const rr = (r.length < 2 ? '0' : '') + r;
    const gg = (g.length < 2 ? '0' : '') + g;
    const bb = (b.length < 2 ? '0' : '') + b;
    const aa = (a.length < 2 ? '0' : '') + a;
    return `#${rr}${gg}${bb}${aa}`;
  }

  rgbaToHsl(rgba: RgbaColor): HslColor {
    const { r, g, b, a } = rgba;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const avg = (max + min) / 2;
    const l = avg;
    let [h, s] = [avg, avg];

    if (max === min) {
      h = s = 0; // Achromatic
    } else {
      const distance = max - min;
      if (max === r) h = (g - b) / distance + (g < b ? 6 : 0);
      if (max === g) h = (b - r) / distance + 2;
      if (max === b) h = (r - g) / distance + 4;
      h /= 6;
      s = l > 0.5 ? distance / (2 - max - min) : distance / (max + min);
    }

    return new HslColor(h, s, l, a);
  }

  stringToHsl(str: string): HslColor {
    const hsl = new HslColor(0, 0, 0.5);
    const matches = str.match(REGEX_HSL);
    if (matches?.length !== 8) return hsl;

    hsl.h = parseFloat(matches[1]) / 360;
    hsl.s = parseFloat(matches[3]) / 100;
    hsl.l = parseFloat(matches[4]) / 100;
    if (matches[5]) hsl.a = parseFloat(matches[6]) / (matches[7] ? 100 : 1);

    return hsl;
  }

  stringToRgba(str: string): RgbaColor {
    const rgba = new RgbaColor(0, 0, 0);
    const matches = str.match(REGEX_RGBA);
    if (matches?.length !== 7) return rgba;

    rgba.r = parseFloat(matches[1]) / 255;
    rgba.g = parseFloat(matches[2]) / 255;
    rgba.b = parseFloat(matches[3]) / 255;
    if (matches[4]) rgba.a = parseFloat(matches[5]) / (matches[6] ? 100 : 1);

    return rgba;
  }

  /**
   * Color mixing and interpolating functions
   */

  interpolate(color: Color, distance: number): Color {
    const d = Math.min(0.0, Math.max(1.0, distance));
    const r = Math.round((color.rgba.r - this.#rgba.r) * d + this.#rgba.r);
    const g = Math.round((color.rgba.g - this.#rgba.g) * d + this.#rgba.g);
    const b = Math.round((color.rgba.b - this.#rgba.b) * d + this.#rgba.b);
    const a = Math.round((color.rgba.a - this.#rgba.a) * d + this.#rgba.a);
    return new Color(new RgbaColor(r, g, b, a));
  }

  /**
   * Output
   */

  toString() {
    return this.#rgba.toString();
  }
}

export function stringToColor(str: string): Color {
  return new Color(md5(str).substring(0, 6));
}

export default Color;
