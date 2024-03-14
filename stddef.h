#ifndef _STDDEF_H
#define _STDDEF_H

#define NULL ((void*)0)
#define offsetof(type, member) ((unsigned long) &((type *)0)->member)
typedef long ptrdiff_t;
typedef unsigned long size_t;

#endif
