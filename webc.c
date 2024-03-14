#include "stdlib.h"
#include "string.h"
#include "locale.h"
#include "stdbool.h"
#include "unistd.h"
#include "stdio.h"
#include "setjmp.h"
#include "errno.h"
#include "ctype.h"

#define STB_SPRINTF_IMPLEMENTATION
#include "stb_sprintf.h"

// string.h

void *memset(void *s, int c, size_t n){
    unsigned char *dst = s;
    for(size_t i = 0; i < n; i++){
        dst[i] = (unsigned char)c;
    }
    return s;
}

void *memcpy(void *dst, const void *src, size_t n){
    unsigned char *d = dst;
    const unsigned char *s = src;
    for(size_t i = 0; i < n; i++, d++, s++){
        *d = *s;
    }
    return dst;
}

void *memmove(void *dst, const void *src, size_t n){
    if(dst < src){
        // moving leftwards;
        unsigned char *d = dst;
        const unsigned char *s = src;
        for(size_t i = 0; i < n; i++, d++, s++){
            *d = *s;
        }
    }else{
        // moving rightwards
        unsigned char *d = ((unsigned char*)dst) + n - 1;
        const unsigned char *s = ((unsigned char*)src) + n - 1;
        for(size_t i = 0; i < n; i++, d--, s--){
            *d = *s;
        }
    }
    return dst;
}

int memcmp(const void *a, const void *b, size_t n){
    const unsigned char *aa = a;
    const unsigned char *bb = b;
    for(size_t i = 0; i < n; i++, aa++, bb++){
        if(*aa == *bb) continue;
        return *aa - *bb;
    }
    return 0;
}

void *memchr(const void *s, int c, size_t n){
    const unsigned char *src = s;
    for(size_t i = 0; i < n; i++, src++){
        if(*src == (unsigned char)c) return src;
    }
    return NULL;
}

char *strchr(const char *s, int c){
    for(const char *p = s; *p; p++){
        if((int)*p == c) return p;
    }
    return NULL;
}

size_t strlen(const char *s){
    size_t out = 0;
    for(const char *p = s; *p; p++, out++){
        if(!*p) return out;
    }
    return out;
}

char *strpbrk(const char *s, const char *accept){
    for(; *s; s++){
        char c = *s;
        for(const char *x = accept; *x; x++){
            if(c == *x) return s;
        }
    }
    return NULL;
}

char *strcpy(char *dst, const char *src){
    char *retval = dst;
    do {
        *(dst++) = *src;
    } while(*(src++));
    *dst = '\0';
    return retval;
}

size_t strspn(const char *s, const char *accept){
    size_t out = 0;
    for(; *s; s++, out++){
        char c = *s;
        bool found = false;
        for(const char *a = accept; *a; a++){
            if(*a != c) continue;
            found = true;
            break;
        }
        if(!found) break;
    }
    return out;
}

int strcmp(const char *a, const char *b){
    for(; *a && *b; a++, b++){
        if(*a == *b) continue;
        break;
    }
    return *a - *b;
}

int strncmp(const char *a, const char *b, size_t len){
    size_t i = 0;
    for(; *a && *b && i < len; a++, b++, i++){
        if(*a == *b) continue;
        break;
    }
    return (i != len) * (*a - *b);
}

static inline char upperchar(char a){
    if(a < 'a' || a > 'z') return a;
    return a - ('a' - 'A');
}

int strcasecmp(const char *a, const char *b){
    for(; *a && *b; a++, b++){
        if(upperchar(*a) == upperchar(*b)) continue;
        break;
    }
    return upperchar(*a) - upperchar(*b);
}

int strncasecmp(const char *a, const char *b, size_t len){
    size_t i = 0;
    for(; *a && *b && i < len; a++, b++, i++){
        if(upperchar(*a) == upperchar(*b)) continue;
        break;
    }
    return (i != len) * (upperchar(*a) - upperchar(*b));
}

char *strstr(const char *haystack, const char *needle){
    size_t l = strlen(needle);
    for(; *haystack; haystack++){
        if(strncmp(haystack, needle, l)) return haystack;
    }
    return NULL;
}

// locale.h

static const struct lconv lconv = {"."};

struct lconv *localeconv(void){
    return &lconv;
}

// errno.h

int errno = 0;

// stdio.h

struct FILE {
    char buf[1024];
    size_t len;
};

static FILE _stdout = {0};
static FILE _stderr = {0};

FILE* stdout = &_stdout;
FILE* stderr = &_stderr;

static inline void _flush(FILE *f){
    if(!f->len) return;
    webc_print(f->buf, f->len);
    f->len = 0;
}

static inline void _putc(FILE *f, char c){
    if(f->len == sizeof(f->buf)) _flush(f);
    f->buf[f->len++] = c;
    if(c == '\n') _flush(f);
}

static inline void _puts(FILE *f, const char *s){
    while(*s) _putc(f, *(s++));
}

static inline void _putsn(FILE *f, const char *s, size_t len){
    for(size_t i = 0; i < len; i++) _putc(f, s[i]);
}

typedef struct {
    FILE *f;
    char *base;
} print_cb_t;


static char *printfcb(const char *buf, void *user, int len){
    print_cb_t *x = user;
    _putsn(x->f, buf, (size_t)len);
    return x->base;
}

int printf(const char *fmt, ...){
    char buf[STB_SPRINTF_MIN];
    print_cb_t x = {stdout, buf};
    va_list va;
    va_start(va, fmt);
    int retval = stbsp_vsprintfcb(printfcb, (void*)&x, buf, fmt, va);
    va_end(va);
    return retval;
}

int fprintf(FILE *f, const char *fmt, ...){
    char buf[STB_SPRINTF_MIN];
    print_cb_t x = {f, buf};
    va_list va;
    va_start(va, fmt);
    int retval = stbsp_vsprintfcb(printfcb, (void*)&x, buf, fmt, va);
    va_end(va);
    return retval;
}

int snprintf(char *buf, size_t n, const char *fmt, ...){
    va_list va;
    va_start(va, fmt);
    int retval = stbsp_vsnprintf(buf, n, fmt, va);
    va_end(va);
    return retval;
}

int fflush(FILE *f){
    _flush(f);
    // these need to go _somewhere_
    (void)stbsp_sprintf;
    (void)stbsp_snprintf;
    (void)stbsp_vsprintf;
    (void)stbsp_set_separators;
    return 0;
}

size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *f){
    _putsn(f, (char*)ptr, size * nmemb);
    return size * nmemb;
}

int fputc(int c, FILE *f){
    unsigned char u = (unsigned char)c;
    _putc(f, (char)u);
    return c;
}

int fputs(const char *s, FILE *f){
    _puts(f, s);
    return strlen(s);
}

int puts(const char *s){
    _puts(stdout, s);
    _putc(stdout, '\n');
    return 1;
}

// stdlib.h

#ifdef __GNUC__
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-noreturn"
#endif // __GNUC__
void abort(void){
    asm ("unreachable");
}

void exit(int val){
    (void)val;
    asm ("unreachable");
}
#ifdef __GNUC__
#pragma GCC diagnostic pop
#endif // __GNUC__

typedef struct {
    const char *integ;
    size_t ninteg;
    const char *decim;
    size_t ndecim;
    const char *pow;
    size_t npow;
    int sign;
    int psign;
} strtod_t;

static double decdigit(char c){
    return (double)(c - '0');
}

static double hexdigit(char c){
    switch(c){
        case '0': return 0.0;
        case '1': return 1.0;
        case '2': return 2.0;
        case '3': return 3.0;
        case '4': return 4.0;
        case '5': return 5.0;
        case '6': return 6.0;
        case '7': return 7.0;
        case '8': return 8.0;
        case '9': return 9.0;
        case 'A': case 'a': return 10.0;
        case 'B': case 'b': return 11.0;
        case 'C': case 'c': return 12.0;
        case 'D': case 'd': return 13.0;
        case 'E': case 'e': return 14.0;
        case 'F': case 'f': return 15.0;
    }
    abort();
}

double strtod(const char *s, char **p){
    // s = WS* [+-]? NUMBER
    // NUMBER = [0-9]*(.[0-9]*)?([eE][+-]?[0-9]+)?
    //        | 0x[0-9a-F]*(.[0-9a-F]*)?([pP][+-]?[0-9]+)?
    //        | inf(inity)?
    //        | nan

    // remember s for error cases
    if(p) *p = s;

    // whitespace?
    s += strspn(s, " \f\n\r\t\v");

    // sign?
    int sign = 1;
    switch(*s){
        case '-': sign = -1;
        case '+': s++; break;
    }
    // inf or nan?
    switch(*s){
        case 'i':
        case 'I':
            if(strncasecmp(s, "infinity", 8)){
                if(p) *p = s + 8;
                return sign * __builtin_inff();
            }
            if(strncasecmp(s, "inf", 3)){
                if(p) *p = s + 3;
                return sign * __builtin_inff();
            }
            return 0.0;
        case 'n':
        case 'N':
            if(strncasecmp(s, "nan", 3)){
                if(p) *p = s + 3;
                return __builtin_nanf("");
            }
            return 0.0;
    }
    // is it hex?
    const char *digits = "0123456789";
    char exp = 'E';
    bool hex = false;
    if(*s == '0' && (s[1] == 'x' || s[1] == 'X')){
        // yes it is hex
        digits = "0123456789abcdefABCDEF";
        exp = 'P';
        hex = true;
        s += 2;
    }
    // integer component
    const char *integ = s;
    size_t ninteg = strspn(s, digits);
    s += ninteg;
    // radix + decimal?
    const char *decim = NULL;
    size_t ndecim = 0;
    bool radix = false;
    if(*s == '.'){
        radix = true;
        decim = ++s;
        ndecim = strspn(s, digits);
        s += ndecim;
    }
    // validate: at least one digit found
    if(ninteg + ndecim == 0) return 0.0;
    // exponent?
    const char *power = NULL;
    size_t npower = 0;
    if(*s == exp || *s == exp + ('a' - 'A')){
        s++;
        // power is always in decimal digits
        power = s;
        npower = strspn(s, "0123456789");
        s += npower;
        // validate: nonempty exponent
        if(npower == 0) return 0.0;
    }
    // validate: hex must have radix or exponent
    if(hex && !radix && !npower) return 0.0;

    // now convert
    double out = 0.0;
    double mult = hex ? 16 : 10;
    double (*digit)(char) = hex ? hexdigit : decdigit;
    for(size_t i = 0; i < ninteg; i++){
        out = mult*out + digit(integ[i]);
    }
    double scale = mult;
    for(size_t i = 0; i < ndecim; i++){
        out += digit(decim[i]) / scale;
        scale /= mult;
    }
    out *= (double)sign;
    if(npower){
        double p = 0;
        for(size_t i = 0; i < npower; i++){
            // always read decimal digits
            out = mult*out + decdigit(power[i]);
        }
        out *= __builtin_pow(hex ? 2 : 10, p);
    }

    if(__builtin_isinf(out)) errno = ERANGE;
    return out;
}

// setjmp.h

void _setjmp_inner(jmp_buf env, void (*fn)(void*), void*arg, int jmp_id);
void _setjmp_inner(jmp_buf env, void (*fn)(void*), void*arg, int jmp_id){
    // store the jmp_id, provided by JS
    *env = jmp_id;
    fn(arg);
}

extern void webc_longjmp(int jmp_id, int val) __attribute__((noreturn));

void longjmp(jmp_buf env, int val) {
    int jmp_id = *env;
    // call JS to raise an exception for us
    webc_longjmp(jmp_id, val);
}

// unistd.h

int webc_sbrk(intptr_t increment);
void *sbrk(intptr_t increment){
    int ret = webc_sbrk(increment);
    if(ret == -1) errno = ENOMEM;
    return (void*)ret;
}

// ctype.h

int isalnum(int c){
    return isalpha(c) || isdigit(c);
}

int isalpha(int c){
    return isupper(c) || islower(c);
}

int iscntrl(int c){
    return c > 0 && c < 32;
}

int isdigit(int c){
    return c >= '0' && c <= '9';
}

int isgraph(int c){
    return c > ' ';
}

int islower(int c){
    return c >= 'a' && c <= 'z';
}

int ispunct(int c){
    return isgraph(c) && !isalnum(c);
}

int isspace(int c){
    return c == ' ' || c == '\n' || c == '\r'
        || c == '\f' || c == '\t' || c == '\v';
}

int isupper(int c){
    return c >= 'A' && c <= 'Z';
}

int isxdigit(int c){
    return isdigit(c) || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f');
}

int tolower(int c){
    return isupper(c) ? c - ('a' - 'A') : c;
}

int toupper(int c){
    return islower(c) ? c + ('a' - 'A') : c;
}
