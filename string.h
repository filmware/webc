#include <sys/types.h>

void *memset(void*, int, size_t);
void *memcpy(void*, const void*, size_t);
void *memmove(void*, const void*, size_t);
int memcmp(const void*, const void*, size_t);
void *memchr(const void*, int, size_t);

char *strchr(const char *, int);
size_t strlen(const char*);
char *strpbrk(const char*, const char*);
char *strcpy(char*, const char*);
size_t strspn(const char*, const char*);
int strcmp(const char*, const char*);
int strncmp(const char*, const char*, size_t);
int strcasecmp(const char*, const char*);
int strncasecmp(const char*, const char*, size_t);
char *strstr(const char *haystack, const char *needle);

// like musl libc, we don't even bother with strcoll
#define strcoll strcmp
