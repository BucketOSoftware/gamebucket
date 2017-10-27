%start program

%ebnf

%%

program
    : declaration* EOF
      { return $1; }
    ;

declaration
    : table_declaration
    | view_declaration
    | command_declaration
    | type_declaration
    | var_declaration
    | import_stmt
    ;

table_declaration
    : TABLE identifier ':' table_definition
        -> { declaration: $identifier, definition: $table_definition }
    ;

view_declaration
    : VIEW identifier ':' view_definition
        -> { declaration: $identifier, definition: Object.assign($view_definition, { visibility: 'public' }) }
    | VISIBILITY VIEW identifier ':' view_definition
        -> { declaration: $identifier, definition: Object.assign($view_definition, { visibility: $VISIBILITY }) }
    ;

command_declaration
    : COMMAND identifier ':' command_definition
        -> { declaration: $identifier, definition: Object.assign($command_definition, { visibility: 'public' }) }
    ;

type_declaration
    : TYPE identifier ':' type_definition
        -> { declaration: $identifier, definition: $type_definition }
    ;

var_declaration
    : scalar_type identifier ':' type_specifier
        -> { declaration: $identifier, definition: { scalar: $scalar_type, type: $type_specifier } }
    | scalar_type identifier ':' type_specifier '=' literal
        -> { declaration: $identifier, definition: { scalar: $scalar_type, type: $type_specifier, init: $literal } }
    ;

scalar_type: VAR | CONST;

import_stmt
    : IMPORT STRING AS identifier
        -> { import: $STRING, localname: $identifier }
    ;


/* SMALL THINGS */
identifier
    : name
    | '*'
    ;

dotted_identifier
    : identifier -> { ident: $identifier }
    | identifier '.' dotted_identifier -> { ident: $1 + "." + $3.ident }
    ;

literal
    : integer
    | STRING
    ;

/* TABLES */
table_definition
    : column_list table_meta*[meta] -> { table: $column_list, meta: $meta }
    ;

column_list
    : column_definition -> [$1]
    | column_list ',' column_definition -> $1.concat($3)
    ;

column_definition
    : identifier type_specifier
        { $$ = { name: $identifier, type: $type_specifier }; }
    ;

type_specifier /* TODO: what consitutes a valid type? */
    : identifier
        { $$ = [ $identifier ] }
    | identifier '[' integer ']'
        { $$ = [ $identifier, Number.parseInt($integer, 10) ] }
    ;

table_meta
    : '*' call -> $call
    ;

/* VIEWS */
view_definition
    : call+ { $$ = { view: $1 }; }
    ;

call
    : identifier '(' arg_list ')'
        -> { func: $identifier, args: $arg_list }
    | identifier '(' ')'
        -> { func: $identifier, args: [] }
    ;

arg_list
    : arg -> [$1]
    | arg_list ',' arg -> $1.concat($3)
    ;

arg
    : arg alias -> Object.assign($arg, { alias: $alias })
    | literal
    | dotted_identifier
    | js_block
    ;

js_block
    : block_vars?[vars] JS_BLOCK_BEGIN JS_CODE+[code] JS_BLOCK_END
        { $$ = { javascript: $code.join(''), vars: $vars }; }
    ;

block_vars
    : column_list '->'
    ;

alias
    : AS dotted_identifier -> $2.ident
    ;

/* COMMANDS */
command_definition
    : call+
        -> { command: $1 }
    ;


/* TYPES */
type_definition
    : call { $$ = { type: $1 } }
    ;
