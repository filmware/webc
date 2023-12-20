import Color, { HslColor, RgbaColor } from '@/utils/color';

describe('Color Utilities', () => {
  describe('Color Class', () => {
    describe('constructor', () => {
      it('should read hex string', () => {
        expect(new Color('#0099ff').toString()).toBe('rgba(0 153 255 / 1)');
        expect(new Color('#ffeedd').toString()).toBe('rgba(255 238 221 / 1)');
      });

      it('should read hex string with alpha value', () => {
        expect(new Color('#0099ff00').toString()).toBe('rgba(0 153 255 / 0)');
        expect(new Color('#ffeedd99').toString()).toBe('rgba(255 238 221 / 0.6)');
      });

      it('should read hsl string', () => {
        expect(new Color('hsl(0deg 0% 0% / 0)').toString()).toBe('rgba(0 0 0 / 0)');
        expect(new Color('hsl(30deg 10% 20% / 0.6)').toString()).toBe('rgba(56 51 46 / 0.6)');
        expect(new Color('hsl(60deg 100% 100% / 1)').toString()).toBe('rgba(255 255 255 / 1)');
        expect(new Color('hsl(360deg 50% 25% / 25%)').toString()).toBe('rgba(96 32 32 / 0.25)');
      });

      it('should read rgba string', () => {
        expect(new Color('rgba(255 128 0 / 0.5)').toString()).toBe('rgba(255 128 0 / 0.5)');
        expect(new Color('rgba(0 128 255 / 50%)').toString()).toBe('rgba(0 128 255 / 0.5)');
      });

      it('should read hsl object', () => {
        expect(new Color(new HslColor(0.5, 0.7, 0.2, 0.6)).toString()).toBe('rgba(15 87 87 / 0.6)');
      });

      it('should read rgba object', () => {
        expect(new Color(new RgbaColor(1.0, 0.5, 0.0, 0.3)).toString()).toBe(
          'rgba(255 128 0 / 0.3)',
        );
      });
    });
  });
});
