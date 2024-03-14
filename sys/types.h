#ifndef _SYS_TYPES_H
#define _SYS_TYPES_H

#include <stddef.h>

// note that long is uint32_t in wasm32 and uint64_t in wasm64
typedef unsigned long size_t;
typedef long ssize_t;
typedef long long time_t;

#endif
