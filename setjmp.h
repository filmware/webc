typedef int jmp_buf[1];

/* Invent webc_setjmp instead of libc setjmp.

   webc_setjmp() will call javascript to try the fn(arg) call, returning 0 if
   the corresponding longjmp is not called, or returning the int val passed to
   longjmp if it is called. */
int webc_setjmp(jmp_buf env, void (*fn)(void*), void* arg);

// longjmp will call a javascript function to throw an error
void longjmp(jmp_buf env, int val) __attribute__((noreturn));
