import struct
import sys

def png_to_icns(png_path, icns_path):
    with open(png_path, 'rb') as f:
        png_data = f.read()

    icon_type = b'ic08' # 256x256 PNG
    icon_length = 8 + len(png_data)
    total_length = 8 + icon_length

    with open(icns_path, 'wb') as f:
        f.write(b'icns')
        f.write(struct.pack('>I', total_length))
        f.write(icon_type)
        f.write(struct.pack('>I', icon_length))
        f.write(png_data)

if __name__ == "__main__":
    png_to_icns('scripts/package/onyx.png', 'scripts/package/icon.icns')
