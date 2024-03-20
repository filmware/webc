// expose all hooks allowed by expat
typedef struct {
    void (*elem_start)(void*, const char *name, const char **attrs);
    void (*elem_end)(void*, const char *name);
    void (*text)(void*, const char *s, int len);
    void (*processing)(void*, const char *target, const char *data);
    void (*comment)(void*, const char *data);
    void (*cdata_start)(void*);
    void (*cdata_end)(void*);
    void (*dfault)(void*, const char *s, int len);
    void (*dfault_expand)(void*, const char *s, int len);
    int (*external)(
        void*,
        const char *context,
        const char *base,
        const char *sysid,
        const char *pubid
    );
    void (*skipped)(void*, const char *entity_name, int is_parameter_entity);
    int (*unknown_encoding)(void*, const char *name, XML_Encoding *info);
    void (*namespace_start)(void*, const char *prefix, const char *uri);
    void (*namespace_end)(void*, const char *prefix);
    void (*doctype_start)(
        void*,
        const char *doctype_name,
        const char *sysid,
        const char *pubid,
        int has_internal_subset
    );
    void (*doctype_end)(void*);
    void (*elem_decl)(void*, const char *name, XML_Content *model);
    void (*attrlist_decl)(
        void*,
        const char *elem_name,
        const char *attr_name,
        const char *attr_type,
        const char *dflt,
        int is_required
    );
    void (*entity_decl)(
        void*,
        const char *entity_name,
        int is_parameter_entity,
        const char *val,
        int len,
        const char *base,
        const char *sysid,
        const char *pubid,
        const char *notation_name
    );
    void (*notation)(
        void*,
        const char *notation_name,
        const char *base,
        const char *sysid,
        const char *pubid
    );
} xml_hooks_t;


// cause non-standalone documents to error with XML_ERROR_NOT_STANDALONE
int force_standalone(void *data){
    (void)data;
    return XML_STATUS_ERROR;
}


// there's a legacy typo in XML_SetExternalEntityRefHandler
typedef int (*actual_external_f)(
    XML_Parser,
    const char *context,
    const char *base,
    const char *sysid,
    const char *pubid
);


int xmlparse(const char *buf, size_t len, xml_hooks_t *hooks){
    XML_Parser p = NULL;

    int retval = 1;

    // create parser
    p = XML_ParserCreate(NULL);

    // force standalone documents only
    XML_SetNotStandaloneHandler(p, force_standalone);

    // configure user hooks
    XML_SetUserData(p, hooks);
    #define SETHOOK(setter, attr) if(hooks->attr) setter(p, hooks->attr);
    SETHOOK(XML_SetStartElementHandler, elem_start);
    SETHOOK(XML_SetEndElementHandler, elem_end);
    SETHOOK(XML_SetCharacterDataHandler, text);
    SETHOOK(XML_SetProcessingInstructionHandler, processing);
    SETHOOK(XML_SetCommentHandler, comment);
    SETHOOK(XML_SetStartCdataSectionHandler, cdata_start);
    SETHOOK(XML_SetEndCdataSectionHandler, cdata_end);
    SETHOOK(XML_SetDefaultHandler, dfault);
    SETHOOK(XML_SetDefaultHandlerExpand, dfault_expand);
    if(hooks->external){
        XML_SetExternalEntityRefHandler(
            p, (actual_external_f)hooks->external
        );
        XML_SetExternalEntityRefHandlerArg(p, (void*)hooks);
    }
    SETHOOK(XML_SetSkippedEntityHandler, skipped);
    // reuse our normal user data for unknown encoding handler
    if(hooks->unknown_encoding){
        XML_SetUnknownEncodingHandler(
            p, hooks->unknown_encoding, (void*)hooks
        );
    }
    SETHOOK(XML_SetStartNamespaceDeclHandler, namespace_start);
    SETHOOK(XML_SetEndNamespaceDeclHandler, namespace_end);
    SETHOOK(XML_SetStartDoctypeDeclHandler, doctype_start);
    SETHOOK(XML_SetEndDoctypeDeclHandler, doctype_end);
    SETHOOK(XML_SetElementDeclHandler, elem_decl);
    SETHOOK(XML_SetAttlistDeclHandler, attrlist_decl);
    SETHOOK(XML_SetEntityDeclHandler, entity_decl);
    SETHOOK(XML_SetNotationDeclHandler, notation);
    #undef SETHOOK

    // parse document
    enum XML_Status status = XML_Parse(p, buf, (int)len, XML_TRUE);
    if(status != XML_STATUS_OK){
        fprintf(stderr, "failed to parse!\n");
        goto cu;
    }

    // success
    retval = 0;

cu:
    if(p) XML_ParserFree(p);
    return retval;
}


// lua integration //

typedef struct {
    xml_hooks_t hooks;
    lua_State *L;
} tree_t;

// return objects representing each node with:
//   .parent
//   .name
//   .attrs
//   .children
//   .text

void tree_elem_start(void *data, const char *name, const char **attrs){
    lua_State *L = ((tree_t*)data)->L;

    // our parent is top of the stack
    int parent = lua_gettop(L);

    // create our object
    lua_newtable(L);
    int node = lua_gettop(L);

    // create a metatable with a __index table for secondary lookups
    lua_newtable(L); // the __index
    int index = lua_gettop(L);
    lua_newtable(L); // the metatable
    lua_pushstring(L, "__index");
    lua_pushvalue(L, index);
    lua_settable(L, -3);
    lua_setmetatable(L, node);

    // set name
    lua_pushstring(L, name);
    lua_setfield(L, node, "name");

    // set attrs
    lua_newtable(L);
    for(const char **p = attrs; *p && *(p+1); p += 2){
        const char *key = *p;
        const char *val = *(p+1);
        // set in attrs
        lua_pushstring(L, key);
        lua_pushstring(L, val);
        lua_settable(L, -3);
        // possibly set in __index
        lua_getfield(L, index, key);
        if(lua_isnil(L, -1)){
            lua_pushstring(L, key);
            lua_pushstring(L, val);
            lua_settable(L, index);
        }
        lua_pop(L, 1);
    }
    lua_setfield(L, node, "attrs");

    // set text
    lua_pushstring(L, "");
    lua_setfield(L, node, "text");

    // set children
    lua_newtable(L);
    lua_setfield(L, node, "children");

    // set parent
    lua_pushvalue(L, parent);
    lua_setfield(L, node, "parent");

    // append ourselves to parent.__children__
    lua_getfield(L, parent, "children");
    lua_len(L, -1);
    lua_pushinteger(L, 1);
    lua_arith(L, LUA_OPADD);
    lua_pushvalue(L, node);
    lua_settable(L, -3);
    lua_pop(L, 1);

    // set parent.$name as ourselves through its metatable's __index
    // (only if we are the first instance of $name)
    lua_getmetatable(L, parent);
    lua_getfield(L, -1, "__index");
    lua_getfield(L, -1, name);
    if(lua_isnil(L, -1)){
        lua_pushstring(L, name);
        lua_pushvalue(L, node);
        lua_settable(L, -4);
    }
    lua_pop(L, 3);

    // done with our index
    lua_pop(L, 1);

    // node is at the top of the stack
}

void tree_elem_end(void *data, const char *name){
    lua_State *L = ((tree_t*)data)->L;

    // drop node from stack
    lua_pop(L, 1);
}

void tree_text(void *data, const char *s, int len){
    lua_State *L = ((tree_t*)data)->L;
    // grab the existing text
    lua_getfield(L, -1, "text");
    // add this text
    lua_pushlstring(L, s, (size_t)len);
    // concatenate strings
    lua_concat(L, 2);
    // set the result
    lua_setfield(L, -2, "text");
}

// fw.parsexml(text) -> xmlobj
int lua_fw_parsexml(lua_State *L){
    // read string arg
    size_t len;
    const char *buf = luaL_tolstring(L, 1, &len);

    // pop args
    lua_pop(L, 1);

    // create the root object
    lua_newtable(L);
    int root = lua_gettop(L);

    lua_pushstring(L, "root");
    lua_setfield(L, root, "name");

    lua_newtable(L);
    lua_setfield(L, root, "attrs");

    lua_pushstring(L, "");
    lua_setfield(L, root, "text");

    lua_newtable(L);
    lua_setfield(L, root, "children");

    // create a metatable with an empty __index
    lua_newtable(L);
    lua_newtable(L);
    lua_setfield(L, -2, "__index");
    lua_setmetatable(L, root);

    tree_t tree = {
        .hooks = {
            .elem_start = tree_elem_start,
            .elem_end = tree_elem_end,
            .text = tree_text,
        },
        .L = L,
    };

    int ret = xmlparse(buf, len, &tree.hooks);
    if(ret){
        // pop everything
        lua_pop(L, lua_gettop(L));
        // throw an error
        lua_pushstring(L, "failed to parse xml");
        lua_error(L);
    }

    // returns only the xml object
    return 1;
}
