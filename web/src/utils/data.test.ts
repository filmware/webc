import * as utils from '@/utils/data';

describe('Data Utilities', () => {
  describe('percentString', () => {
    it('should convert number to percent string', () => {
      expect(utils.percentString(0)).toBe('0%');
      expect(utils.percentString(0.01)).toBe('1%');
      expect(utils.percentString(0.5)).toBe('50%');
      expect(utils.percentString(0.99)).toBe('99%');
      expect(utils.percentString(1)).toBe('100%');
    });

    it('should conert number to percent string with precision', () => {
      const number = Math.PI / 100;
      expect(utils.percentString(number, 0)).toBe('3%');
      expect(utils.percentString(number, 1)).toBe('3.1%');
      expect(utils.percentString(number, 2)).toBe('3.14%');
      expect(utils.percentString(number, 3)).toBe('3.142%');
      expect(utils.percentString(number, 4)).toBe('3.1416%');
      expect(utils.percentString(number, 5)).toBe('3.14159%');
    });
  });
});
