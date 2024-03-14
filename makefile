CC = clang
CFLAGS = --target=wasm32-unknown-none -nostdlib -Wall -O2 -I.
CFLAGS += -Wno-builtin-requires-header
CFLAGS += -Wno-incompatible-pointer-types-discards-qualifiers

LD = wasm-ld

LDFLAGS = -m wasm32
LDFLAGS += --no-entry
LDFLAGS += --export-all
LDFLAGS += --allow-undefined-file=webc.import
LDFLAGS += --relocatable

MALLOC_CFLAGS = -DHAVE_MMAP=0
MALLOC_CFLAGS += -DLACKS_SYS_PARAM_H=1
MALLOC_CFLAGS += -DLACKS_TIME_H=1
MALLOC_CFLAGS += -DNO_MALLOC_STATS=1
MALLOC_CFLAGS += -Dmalloc_getpagesize=65536
MALLOC_CFLAGS += -Wno-expansion-to-defined
MALLOC_CFLAGS += -Wno-unused-but-set-variable

all: libc.a

webc.o: webc.c *.h sys/*.h makefile

malloc.o: malloc.c *.h sys/*.h makefile
	$(CC) $(CFLAGS) $(MALLOC_CFLAGS) -c -o $@ $<

libc.a: webc.o malloc.o makefile
	$(LD) $(LDFLAGS) -o $@ webc.o malloc.o

clean:
	rm -f *.a *.o
