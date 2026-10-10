# Como criar o site de uma nova cliente

Este site é um **modelo**. Todo o conteúdo específico da cliente fica em um
único arquivo (`cliente.json`); o visual fica em `template.html` +
`assets/css/style.css`. Um script junta tudo e gera o `index.html` final.

## Passo a passo

1. **Copie a pasta inteira do site** para uma pasta nova (ex.: `site-maria`).
2. **Troque as imagens** em `assets/img/` mantendo os mesmos nomes de arquivo
   (ou use nomes novos e ajuste os caminhos no `cliente.json`):

   | Arquivo                    | O que é                               | Tamanho sugerido |
   |----------------------------|----------------------------------------|------------------|
   | `logo-simbolo.png`         | Símbolo da logo, fundo transparente (também vira o ícone da aba) | ~240×240 |
   | `logo-nome.png`            | Nome da marca, fundo transparente      | ~330×90          |
   | `juliana-hero.jpg`         | Foto principal (retrato, vertical)     | ~520×760         |
   | `juliana-sobre.jpg`        | Foto da seção "Quem sou"               | ~900×1080        |
   | `procedimento.jpg`         | Foto da seção "Como funciona"          | ~900×1350        |
   | `resultado-*.jpg`          | Antes e depois lado a lado (formato 2:1) | ~1000×500      |
   | `og-image.jpg`             | Imagem da prévia ao compartilhar o link no WhatsApp | 1200×630 |

3. **Edite `_modelo/cliente.json`**: nome, textos, WhatsApp, endereço,
   Instagram, cores, procedimentos, resultados e depoimentos.
   - `contato.whatsapp`: só números, com 55 + DDD (ex.: `5511912345678`).
   - `contato.mensagemProcedimento`: `{procedimento}` é trocado pelo nome de
     cada procedimento no botão "Quero saber mais".
   - `marca.registro`: número do conselho profissional (ex.: `COREN-SP 000000`).
     Se ficar vazio, a linha não aparece.
   - `contato.googleAvaliacoes`: link das avaliações no Google (opcional).
   - `depoimentos`: use **apenas depoimentos reais**. Lista vazia `[]`
     esconde a seção.
   - `desenvolvedor`: seu nome e site, para aparecer o crédito no rodapé.
   - `procedimentos[].icone`: `rosto`, `labios`, `brilho`, `perfil`,
     `colageno` ou `gota`.
   - Cores: `destaque` é a cor dos botões (texto branco por cima). Para manter
     a leitura boa, use um tom médio-escuro. Confira o contraste em
     https://webaim.org/resources/contrastchecker/ (mínimo 4.5:1).

4. **Gere o site** (PowerShell, dentro da pasta do site):

   ```
   powershell -ExecutionPolicy Bypass -File _modelo\build.ps1
   ```

   O script avisa se algum campo do template ficou sem valor.

5. **Publique**: suba `index.html`, `assets/` e `CNAME` (se houver domínio
   próprio) no GitHub Pages. A pasta `_modelo/` pode ir junto: o GitHub Pages
   não publica pastas que começam com `_`.

## Fontes

Títulos em **Bodoni Moda** e textos em **Manrope** (Google Fonts). Para
trocar, altere o `<link>` de fontes no `template.html` e as variáveis
`--font-title` / `--font-body` no começo do `style.css`.

> Evite a fonte *Cormorant Garamond*: na versão atual do Google Fonts o acento
> circunflexo ("você") aparece deslocado.
