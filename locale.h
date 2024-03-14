// just enough to make lua compile, and we always assume en_US locale
struct lconv {
    const char *decimal_point;
};
struct lconv *localeconv(void);
