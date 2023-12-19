import * as utils from '@/utils/string';

describe('String Utilities', () => {
  describe('camelToKebab', () => {
    it('should convert camel case to kebab case', () => {
      expect(utils.camelToKebab('bigBird')).toBe('big-bird');
    });

    it('should trim spaces', () => {
      expect(utils.camelToKebab('   bigBird  ')).toBe('big-bird');
    });

    it('should handle non-alphabet camel casing', () => {
      expect(utils.camelToKebab('bigBird777')).toBe('big-bird777');
    });
  });

  describe('randomUUID', () => {
    it('should generate a random UUID', () => {
      const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (let i = 0; i < 10; i++) {
        expect(REGEX_UUID.test(utils.randomUUID())).toBe(true);
      }
    });
  });
});
