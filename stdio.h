#ifndef STDIO_H
#define STDIO_H

#include <stddef.h>

// for now, webc ignores all FILE* values entirely
// that could change, someday
struct FILE;
typedef struct FILE FILE;
extern FILE *stdout;
extern FILE *stderr;

#ifdef __GNUC__
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wbuiltin-requires-header"
#endif // __GNUC__

int printf(const char *fmt, ...);
int fprintf(FILE *f, const char *fmt, ...);
int snprintf(char *buf, size_t n, const char *fmt, ...);
int fflush(FILE *f);
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *f);
int fputc(int c, FILE *f);
int fputs(const char *s, FILE *f);
int puts(const char *s);

#ifdef __GNUC__
#pragma GCC diagnostic pop
#endif // __GNUC__

void webc_print(const char *buf, size_t len);

#endif
