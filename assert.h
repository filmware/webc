#ifndef _ASSERT_H
#define _ASSERT_H

#ifdef NDEBUG
    #define assert(val) do { \
        fprintf(stderr, "assertion failed\n"); \
        abort(); \
    } while(0)
#else
    #define assert(ignore) ((void)0)
#endif

#endif
