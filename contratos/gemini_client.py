import os
from google import genai


def get_gemini_client():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY não está definida nas variáveis de ambiente.")
    return genai.Client(api_key=api_key)


def ask_gemini(prompt: str) -> str:
    """
    Envia um prompt simples para o modelo Gemini 1.5 Flash e retorna o texto.
    """
    client = get_gemini_client()

    # use um modelo válido para a API atual
    response = client.models.generate_content(
        model="gemini-1.5-flash-002",   # <- TROCAMOS AQUI
        contents=prompt,
    )

    return response.text

