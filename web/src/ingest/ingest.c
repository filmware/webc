#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>

#include <expat.h>

#include <lua.h>
#include <lualib.h>
#include <lauxlib.h>

#include "ingest.h"

#include "xml.c"

int lua_print(lua_State *L){
    int nargs = lua_gettop(L);
    for(int i = 0; i < nargs; i++){
        // get the string
        size_t len;
        const char *str = luaL_tolstring(L, i+1, &len);
        printf("%.*s\t", (int)len, str);
        lua_pop(L, 1);
    }
    printf("\n");

    // pop all the args too
    lua_pop(L, nargs);

    // return nothing on the stack
    return 0;
}

// fw.export(report) -> nil
int lua_fw_export(lua_State *L){
    // XXX: json-encode the table
    js_export(NULL, 0);

    // return nothing on the stack
    return 0;
}

void lua_setfw(lua_State *L){
    lua_newtable(L);
    int fw = lua_gettop(L);

    // fw.export
    lua_pushcfunction(L, lua_fw_export);
    lua_setfield(L, fw, "export");

    // fw.xmlparse
    lua_pushcfunction(L, lua_fw_parsexml);
    lua_setfield(L, fw, "parsexml");

    lua_setglobal(L, "fw");
}

// main entrypoint for ingest.wasm
int run(char *script, char *input){
    lua_State *L = NULL;
    int retval = -1;

    L = luaL_newstate();
    if(!L){
        fprintf(stderr, "out of memory!");
        goto cu;
    }

    // set up globals
    luaL_openlibs(L);
    lua_pushcfunction(L, lua_print);
    lua_setglobal(L, "print");
    lua_setfw(L);
    lua_pushstring(L, input);
    lua_setglobal(L, "input");

    // load script
    int ret = luaL_loadstring(L, script);
    if(ret != 0){
        size_t len;
        const char *err = lua_tolstring(L, lua_gettop(L), &len);
        fprintf(stderr, "%.*s\n", (int)len, err);
        goto cu;
    }

    // execute script
    ret = lua_pcall(L, 0, 1, 0);
    if(ret != 0){
        size_t len;
        const char *err = lua_tolstring(L, lua_gettop(L), &len);
        fprintf(stderr, "%.*s\n", (int)len, err);
        goto cu;
    }

    retval = 0;

cu:
    if(L) lua_close(L);
    free(script);
    free(input);
    return retval;
}
