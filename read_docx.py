import zipfile
import xml.etree.ElementTree as ET
import sys

def read_docx(path):
    document_path = 'word/document.xml'
    word_schema = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    
    with zipfile.ZipFile(path) as docx:
        tree = ET.XML(docx.read(document_path))
    
    paragraphs = []
    for paragraph in tree.iter('{%s}p' % word_schema):
        texts = [node.text for node in paragraph.iter('{%s}t' % word_schema) if node.text]
        if texts:
            paragraphs.append(''.join(texts))
            
    return '\n'.join(paragraphs)

for p in sys.argv[1:]:
    print(f"\n============================================\nCONTENT OF {p}\n============================================")
    try:
        print(read_docx(p))
    except Exception as e:
        print(f"Error reading {p}: {e}")
