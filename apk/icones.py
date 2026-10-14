# Gera os ícones do aplicativo Android a partir do ícone do site (a caixinha de papelão).
# Uso: python icones.py ../icones/icone-cheio-512.png android/app/src/main/res
import os
import sys

from PIL import Image, ImageDraw

origem, res = sys.argv[1], sys.argv[2]
icone = Image.open(origem).convert("RGBA")
fundo = icone.getpixel((2, 2))  # a cor que preenche o ícone até a borda
densidades = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for nome, escala in densidades.items():
    pasta = os.path.join(res, "mipmap-" + nome)
    os.makedirs(pasta, exist_ok=True)
    n = int(48 * escala)
    quadrado = icone.resize((n, n), Image.LANCZOS)
    quadrado.save(os.path.join(pasta, "ic_launcher.png"))
    mascara = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mascara).ellipse((0, 0, n - 1, n - 1), fill=255)
    redondo = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    redondo.paste(quadrado, (0, 0), mascara)
    redondo.save(os.path.join(pasta, "ic_launcher_round.png"))
    # Ícone adaptativo: a camada da frente tem 108dp, e o Android mostra só os 72dp do meio. A
    # caixinha entra um pouco maior que isso (84dp): o ícone do site já tem a própria folga.
    total, miolo = int(108 * escala), int(84 * escala)
    frente = Image.new("RGBA", (total, total), fundo)
    frente.paste(icone.resize((miolo, miolo), Image.LANCZOS), ((total - miolo) // 2, (total - miolo) // 2))
    frente.save(os.path.join(pasta, "ic_launcher_foreground.png"))
valores = os.path.join(res, "values")
os.makedirs(valores, exist_ok=True)
cor = "#%02x%02x%02x" % fundo[:3]
with open(os.path.join(valores, "ic_launcher_background.xml"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">%s</color>\n</resources>\n' % cor)
print("ícones gerados em", res, "com fundo", cor)
