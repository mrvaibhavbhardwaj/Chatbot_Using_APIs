from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "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"
)

# English to Hindi translation
text_to_translate = "Hello, how are you? I am learning Hindi."

completion = client.chat.completions.create(
  model="baichuan-inc/baichuan2-13b-chat",
  messages=[
    {"role": "system", "content": "You are a translator. Translate English to Hindi accurately."},
    {"role": "user", "content": f"Translate this to Hindi: {text_to_translate}"}
  ],
  temperature=0.3,  # Lower temperature for more consistent translations
  max_tokens=500,
  stream=True
)

print("English:", text_to_translate)
print("Hindi: ", end="")
for chunk in completion:
  if chunk.choices[0].delta.content is not None:
    print(chunk.choices[0].delta.content, end="", flush=True)
print()
