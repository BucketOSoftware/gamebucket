%lex

%x embedded-code
%options case-insensitive


%%
\s+                         /* space */
"//".*                      /* comments */

"->"        return '->'
":"         return ':'
"="         return '='
"("         return '('
")"         return ')'
"["         return '['
"]"         return ']'
","         return ','
"."         return '.'
"*"         return '*'
<<EOF>>     return 'EOF'

\"(\\.|[^\\"])*\"   yytext = yytext.substr(1, yyleng - 2); return 'STRING'

"table"     return 'TABLE'
"view"      return 'VIEW'
"command"   return 'COMMAND'
"type"      return 'TYPE'
"as"        return 'AS'
"import"    return 'IMPORT'
"var"       return 'VAR'
"const"     return 'CONST'

(private|public) return 'VISIBILITY'

// HANDLING EMBEDDED JS
"{"         this.begin('embedded-code'); return 'JS_BLOCK_BEGIN'
<embedded-code>"{"  %{
    embeddedBraces++;
    return 'JS_CODE'
%}
<embedded-code>"}"  %{
    if (embeddedBraces > 0) {
        embeddedBraces--;
        return 'JS_CODE'
    } else {
        this.popState();
        return 'JS_BLOCK_END';
    }
%}
<embedded-code>[^}{]+   return 'JS_CODE'

[a-zA-Z_][a-zA-Z0-9_]*        return 'name';
\d+                         return 'integer';


%%

embeddedBraces = 0
