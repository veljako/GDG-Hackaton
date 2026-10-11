"""Embed an actual MP4 into Artifact Tool's existing slide-4 poster.

This edits the OOXML media relationship only. Slide layout, text, notes and
poster come from the editable Artifact Tool presentation.
"""
from pathlib import Path
import sys
import zipfile
import xml.etree.ElementTree as ET

deck, video = map(Path, sys.argv[1:3])
ns = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
}
for prefix, uri in ns.items():
    ET.register_namespace(prefix, uri)
rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
ct_ns = "http://schemas.openxmlformats.org/package/2006/content-types"

with zipfile.ZipFile(deck) as source:
    entries = {info.filename: source.read(info.filename) for info in source.infolist()}
root = ET.fromstring(entries["ppt/slides/slide4.xml"])
images = root.findall(".//p:pic", ns)
poster = next((pic for pic in images
               if pic.find("p:nvPicPr/p:cNvPr", ns).get("descr") == "GEvents walkthrough video poster"), None)
# Artifact Tool currently keeps alt in its model but omits it from exported
# cNvPr. Accept only the single image at the authored full-slide poster frame.
if poster is None and len(images) == 1:
    frame = images[0].find("p:spPr/a:xfrm", ns)
    offset = frame.find("a:off", ns)
    extent = frame.find("a:ext", ns)
    if (offset.get("x"), offset.get("y"), extent.get("cx"), extent.get("cy")) == (
        "609600", "0", "10972800", "6858000"
    ):
        poster = images[0]
if poster is None:
    raise ValueError("Slide 4 must have the authored walkthrough poster")
properties = poster.find("p:nvPicPr/p:cNvPr", ns)
properties.set("name", "GEvents walkthrough video")
properties.set("descr", "GEvents walkthrough video poster")
ET.SubElement(properties, f"{{{ns['a']}}}hlinkClick", {
    "action": "ppaction://media"
})
nonvisual = poster.find("p:nvPicPr/p:nvPr", ns)
ET.SubElement(nonvisual, f"{{{ns['a']}}}videoFile", {f"{{{ns['r']}}}link": "rIdGEventsVideo"})
extension_list = ET.SubElement(nonvisual, f"{{{ns['p']}}}extLst")
extension = ET.SubElement(extension_list, f"{{{ns['p']}}}ext", {"uri": "{DAA4B4D4-9D5F-4E6B-BB67-62119FA6918F}"})
ET.SubElement(extension, f"{{{ns['p14']}}}media", {f"{{{ns['r']}}}embed": "rIdGEventsMedia"})

# A media timing node lets PowerPoint treat the poster as playable video.
shape_id = properties.get("id")
timing = root.find("p:timing", ns)
if timing is None:
    timing = ET.SubElement(root, f"{{{ns['p']}}}timing")
node_list = ET.SubElement(timing, f"{{{ns['p']}}}tnLst")
parallel = ET.SubElement(node_list, f"{{{ns['p']}}}par")
root_time = ET.SubElement(parallel, f"{{{ns['p']}}}cTn", {"id": "100", "dur": "indefinite", "restart": "never", "nodeType": "tmRoot"})
children = ET.SubElement(root_time, f"{{{ns['p']}}}childTnLst")
media_video = ET.SubElement(children, f"{{{ns['p']}}}video")
media_node = ET.SubElement(media_video, f"{{{ns['p']}}}cMediaNode", {"vol": "0"})
media_time = ET.SubElement(media_node, f"{{{ns['p']}}}cTn", {"id": "101", "fill": "hold", "display": "0"})
conditions = ET.SubElement(media_time, f"{{{ns['p']}}}stCondLst")
ET.SubElement(conditions, f"{{{ns['p']}}}cond", {"delay": "indefinite"})
target = ET.SubElement(media_node, f"{{{ns['p']}}}tgtEl")
ET.SubElement(target, f"{{{ns['p']}}}spTgt", {"spid": shape_id})

relationships = ET.fromstring(entries["ppt/slides/_rels/slide4.xml.rels"])
for identifier, kind in [("rIdGEventsVideo", "video"), ("rIdGEventsMedia", "media")]:
    relation_type = ("http://schemas.microsoft.com/office/2007/relationships/media" if kind == "media"
                     else "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video")
    ET.SubElement(relationships, f"{{{rel_ns}}}Relationship", {"Id": identifier, "Type": relation_type, "Target": "../media/gevents-walkthrough.mp4"})
types = ET.fromstring(entries["[Content_Types].xml"])
if not any(item.get("Extension") == "mp4" for item in types):
    ET.SubElement(types, f"{{{ct_ns}}}Default", {"Extension": "mp4", "ContentType": "video/mp4"})
entries["ppt/slides/slide4.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
entries["ppt/slides/_rels/slide4.xml.rels"] = ET.tostring(relationships, encoding="utf-8", xml_declaration=True)
ET.register_namespace("", ct_ns)
entries["[Content_Types].xml"] = ET.tostring(types, encoding="utf-8", xml_declaration=True)
entries["ppt/media/gevents-walkthrough.mp4"] = video.read_bytes()
candidate = deck.with_name(deck.stem + "-media.pptx")
with zipfile.ZipFile(candidate, "w", zipfile.ZIP_DEFLATED) as output:
    for name, content in entries.items():
        output.writestr(name, content)
print(candidate)
