void *malloc(unsigned long);
void *realloc(void*, unsigned long);
void free(void*);
void abort(void) __attribute__((noreturn));
void exit(int val) __attribute__((noreturn));
double strtod(const char*, char **);
