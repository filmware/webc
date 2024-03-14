#ifndef _MATH_H
#define _MATH_H

#include <openlibm_math.h>

static inline int abs(int x){
    return x < 0 ? -x : x;
}

#endif
