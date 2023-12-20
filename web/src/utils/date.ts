import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export function timeAgo(utc: Date | string) {
  return dayjs(utc).fromNow();
}

export function timeFormat(utc: Date | string, format = 'hh:mm A') {
  return dayjs(utc).format(format);
}

export function getUTCString(format = 'YYYY-MM-DDTHH:mm:ss.SSS[Z]'): string {
  return dayjs().utc().format(format);
}
