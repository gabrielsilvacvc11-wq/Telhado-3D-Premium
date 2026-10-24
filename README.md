# Telhado 3D Premium

Simulador fotovoltaico em 3D, em um único arquivo (`index.html`). Monte o telhado, posicione os módulos solares e veja o sol e as sombras na casa do cliente. Funciona no computador e no celular.

## O que tem

- **Seis modelos de telhado:** duas águas, quatro águas, galpão, embutido, laje plana e solo, com largura, comprimento, altura da parede, inclinação e giro da casa.
- **Módulos de 610 W:** distribuídos nas águas norte e sul. Na laje plana e no solo ficam numa mesa inclinada para o norte, com pés de apoio. Você escolhe a quantidade.
- **Sol:** slider de hora, botão para simular o dia e sombras que acompanham o sol.
- **Vizinho:** casa, prédio ou árvore em qualquer lado, com altura e distância ajustáveis.
- **Resultado:** potência instalada (kWp), potência no momento, geração estimada no dia e área ocupada.
- **Modo realista:** céu que muda com a hora, reflexo nos painéis, sombras suaves, telha com relevo, grama, árvores e rua. O botão no topo do painel alterna entre Realista e Simples (mais leve para celulares fracos).

## Como usar

1. Abra o `index.html` no navegador (precisa de internet, pois o Three.js é carregado de um CDN).
2. Escolha o modelo do telhado e ajuste as medidas.
3. Defina a quantidade de módulos e a água (norte ou sul).
4. Mexa na hora do dia ou toque em **Simular o dia**.
5. Adicione um vizinho para ver a sombra no telhado.

Arraste para girar, role ou use dois dedos para aproximar.

## Como publicar

**Vercel**
1. Crie um repositório no GitHub e envie o `index.html` e este `README.md` na raiz.
2. Na Vercel, importe o repositório. Não precisa de build nem de configuração: ela publica o `index.html` direto.

**GitHub Pages**
1. No repositório, vá em *Settings → Pages*.
2. Em *Branch*, escolha `main` e a pasta `/ (root)`, e salve.

## Como a estimativa é calculada

A geração do dia soma, a cada meia hora, o quanto cada módulo está virado para o sol, com céu limpo e 82% de eficiência do sistema. É uma estimativa para apresentação, não um laudo técnico.

## Limitações conhecidas

- A sombra do vizinho aparece na cena, mas ainda não reduz a geração calculada.
- Não calcula perda anual nem separa por inversor ou string.
- Sem calhas, beirais detalhados e janelas elaboradas.
- Não salva projetos nem gera relatório em PDF.

## Tecnologias

HTML, CSS e JavaScript puro, com [Three.js](https://threejs.org) r128 carregado pelo jsDelivr. Texturas geradas no próprio navegador, sem imagens externas.
