#include <sys/types.h>

/* in webc, getrandom is backed by crypto.getRandomValues() and it neither
   fails with EAGAIN nor does it block (which means flags are ignored) */
ssize_t getrandom(void *buf, size_t buflen, unsigned int flags);

void webc_getrandom(void *buf, size_t buflen);
