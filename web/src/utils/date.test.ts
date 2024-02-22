import * as utils from '@/utils/date';

describe('Date Utilities', () => {
  describe('timeAgo', () => {
    it('should format time ago', () => {
      const secAgo = new Date(Date.now() - 1000);
      const minAgo = new Date(Date.now() - 60_000);
      expect(utils.timeAgo(secAgo)).toBe('a few seconds ago');
      expect(utils.timeAgo(minAgo)).toBe('a minute ago');
    });
  });

  describe('timeFormat', () => {
    const date = new Date('2023-12-19T12:34:00.000Z');

    it('should format time locally', () => {
      expect(utils.timeFormat(date)).toBe('05:34 AM');
    });

    it('should format time with custom format', () => {
      expect(utils.timeFormat(date, 'YYYY-MM-DD')).toBe('2023-12-19');
    });
  });

  describe('getUTCString', () => {
    it('should return UTC datetime string', () => {
      const formatRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
      expect(formatRegex.test(utils.getUTCString())).toBe(true);
    });
  });
});
