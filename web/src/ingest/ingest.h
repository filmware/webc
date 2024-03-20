// calls defined in javascript
void js_export(char *json, size_t len);

// xml.c
int lua_fw_parsexml(lua_State *L);

// ingest.c
int run(char *script, char *inputs);
