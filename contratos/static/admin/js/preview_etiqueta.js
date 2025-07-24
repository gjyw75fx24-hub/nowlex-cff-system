document.addEventListener('DOMContentLoaded', function () {
  const nome = document.getElementById('id_nome');
  const fundo = document.getElementById('id_cor_fundo');
  const fonte = document.getElementById('id_cor_fonte');

  const previewDiv = document.createElement('div');
  previewDiv.style.marginTop = '10px';
  previewDiv.style.padding = '4px 10px';
  previewDiv.style.borderRadius = '5px';
  previewDiv.style.fontWeight = 'bold';
  previewDiv.textContent = nome.value || 'Pré-visualização';
  fundo.parentNode.appendChild(previewDiv);

  function atualizarPreview() {
    previewDiv.textContent = nome.value || 'Pré-visualização';
    previewDiv.style.backgroundColor = fundo.value;
    previewDiv.style.color = fonte.value;
  }

  nome.addEventListener('input', atualizarPreview);
  fundo.addEventListener('input', atualizarPreview);
  fonte.addEventListener('input', atualizarPreview);
  atualizarPreview();
});
