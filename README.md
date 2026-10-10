# Juliana Felix Beauté — site

Landing page da clínica de estética avançada da Juliana Felix.
Publicado em https://julianafelix.com.br (GitHub Pages, branch `main`, pasta raiz).

## Estrutura

```
index.html          ← página publicada (GERADA — não editar à mão)
assets/
  css/style.css     ← visual
  js/main.js        ← menu, animações, carrossel, ampliar fotos
  img/              ← imagens do site
imagens_ads/        ← peças das campanhas de Google Ads (não usadas no site)
_modelo/
  cliente.json      ← TODO o conteúdo: textos, contatos, cores, listas
  template.html     ← estrutura HTML com marcadores {{...}}
  build.ps1         ← gera o index.html
  COMO-USAR.md      ← como montar o site de uma nova cliente
```

## Para alterar algo no site

1. Edite `_modelo/cliente.json` (textos, telefone, procedimentos...)
   ou `assets/css/style.css` (visual).
2. Rode `powershell -ExecutionPolicy Bypass -File _modelo\build.ps1`.
3. Suba os arquivos alterados para o GitHub. O site atualiza em alguns minutos.

## Pendências

- Substituir os depoimentos de exemplo por avaliações reais (`depoimentos` no `cliente.json`).
- Preencher o número do COREN em `marca.registro`.
- Preencher `contato.googleAvaliacoes` quando o Perfil da Empresa no Google estiver ativo.
- Preencher `desenvolvedor` com o nome/site de quem desenvolveu.
