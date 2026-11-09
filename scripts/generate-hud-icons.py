from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
root=Path(__file__).resolve().parents[1]
S=3
atlas=Image.new('RGBA',(1024*S,128*S))
def poly(d,pts,c):d.polygon([(int(x*S),int(y*S)) for x,y in pts],fill=c)
for idx,kind in enumerate(['copper','silver','crystal','gold','bag','pick','shop','mouse']):
 im=Image.new('RGBA',(128*S,128*S));d=ImageDraw.Draw(im)
 if kind=='copper':
  poly(d,[(11,66),(24,41),(48,36),(70,49),(79,79),(61,103),(31,108),(13,91)],'#9C5C3C')
  poly(d,[(11,66),(24,41),(48,36),(43,65),(26,78)],'#ECB081')
  poly(d,[(43,65),(70,49),(79,79),(61,103),(39,87)],'#C8834F')
  poly(d,[(63,34),(80,17),(102,25),(118,53),(107,79),(79,79),(70,49)],'#A8633D')
  poly(d,[(63,34),(80,17),(102,25),(91,45),(70,49)],'#F2BB88')
  poly(d,[(91,45),(102,25),(118,53),(107,79),(96,67)],'#CA8A59')
  d.line([(23*S,84*S),(40*S,91*S),(50*S,87*S)],fill='#F8CAA0',width=3*S)
 elif kind=='silver':
  poly(d,[(11,84),(39,66),(111,61),(118,78),(93,94),(29,104)],'#678F98')
  poly(d,[(11,84),(39,66),(111,61),(84,83),(29,92)],'#D2E5E3')
  poly(d,[(8,59),(33,41),(108,35),(119,49),(89,67),(27,76)],'#80A5AD')
  poly(d,[(8,59),(33,41),(108,35),(84,55),(27,64)],'#EEF2E7')
  poly(d,[(25,35),(51,21),(107,19),(111,31),(84,47),(34,48)],'#ABC7CB')
  poly(d,[(25,35),(51,21),(107,19),(81,35),(34,39)],'#F4F6E8')
 elif kind=='crystal':
  poly(d,[(17,72),(26,32),(40,18),(56,38),(52,99),(33,111)],'#79649F')
  poly(d,[(26,32),(40,18),(41,78),(33,111),(17,72)],'#B9A5DA')
  poly(d,[(45,93),(52,27),(71,5),(91,26),(85,103),(64,120)],'#9680B8')
  poly(d,[(52,27),(71,5),(68,95),(64,120),(45,93)],'#D6C4EE')
  poly(d,[(71,5),(91,26),(68,36)],'#EEE3F9')
  poly(d,[(83,101),(91,56),(105,39),(119,61),(111,106),(97,118)],'#8C76AE')
  poly(d,[(91,56),(105,39),(103,92),(97,118),(83,101)],'#C7B1E5')
 elif kind=='gold':
  d.ellipse((13*S,49*S,83*S,112*S),fill='#A67A25')
  d.ellipse((14*S,43*S,80*S,101*S),fill='#E8B948')
  d.ellipse((49*S,17*S,109*S,78*S),fill='#B68B2E')
  d.ellipse((47*S,12*S,108*S,68*S),fill='#F2CD63')
  d.ellipse((73*S,65*S,121*S,109*S),fill='#B68B2E')
  d.ellipse((70*S,60*S,118*S,101*S),fill='#E7B441')
  d.arc((24*S,51*S,65*S,87*S),195,283,fill='#FFE9A4',width=6*S)
  d.arc((58*S,22*S,95*S,55*S),195,281,fill='#FFF0B6',width=6*S)
  d.ellipse((89*S,72*S,98*S,80*S),fill='#FFE99C')
 elif kind=='bag':
  d.rounded_rectangle((22*S,38*S,107*S,113*S),radius=30*S,fill='#BFA678')
  poly(d,[(36,16),(56,23),(78,18),(94,23),(85,46),(40,46)],'#D7C098')
  d.line([(36*S,44*S),(92*S,44*S)],fill='#745C3C',width=6*S)
  d.arc((47*S,50*S,83*S,91*S),190,360,fill='#F1DEC0',width=4*S)
  poly(d,[(49,74),(64,63),(79,74),(64,88)],'#90764D')
  d.line([(31*S,73*S),(34*S,96*S),(45*S,103*S)],fill='#E9D4AF',width=3*S)
 elif kind=='pick':
  d.line([(33*S,113*S),(82*S,27*S)],fill='#6C422C',width=15*S)
  d.line([(30*S,111*S),(78*S,27*S)],fill='#C38B55',width=8*S)
  poly(d,[(13,40),(34,20),(64,14),(95,24),(118,53),(87,39),(66,37),(42,31)],'#B9CED0')
  poly(d,[(13,40),(34,20),(64,14),(95,24),(66,24),(39,28)],'#EFF3DD')
  poly(d,[(67,24),(79,28),(72,44),(61,38)],'#5E858A')
 elif kind=='shop':
  d.rounded_rectangle((24*S,48*S,106*S,111*S),radius=5*S,fill='#B99D6F')
  poly(d,[(13,47),(34,18),(96,18),(117,47)],'#E6D7AC')
  for x in [36,67,98]:poly(d,[(x-11,19),(x,19),(x+9,47),(x-10,47)],'#547D79')
  d.rectangle((37*S,60*S,91*S,91*S),fill='#224B4D')
  d.rectangle((31*S,91*S,100*S,99*S),fill='#F4E6BD')
 elif kind=='mouse':
  d.rounded_rectangle((30*S,12*S,98*S,115*S),radius=34*S,fill='#EFF0DE')
  d.line([(64*S,13*S),(64*S,55*S)],fill='#597B7A',width=4*S)
  d.line([(31*S,55*S),(97*S,55*S)],fill='#597B7A',width=4*S)
  d.rounded_rectangle((57*S,25*S,71*S,45*S),radius=6*S,fill='#D8AF56')
 atlas.alpha_composite(im,(idx*128*S,0))
atlas.resize((1024,128),Image.Resampling.LANCZOS).save(root/'Unity/Assets/Resources/QuarryHudIcons.png')


# Silhouette masks for the one weigh ticket and the public two-load assay mark.
receipt=Image.new('RGBA',(512,320));d=ImageDraw.Draw(receipt)
d.rounded_rectangle((0,0,511,319),radius=15,fill='white')
for x in (0,511):d.ellipse((x-12,178-12,x+12,178+12),fill=(0,0,0,0))
for x in range(11,500,22):d.polygon([(x-5,320),(x,313),(x+5,320)],fill=(0,0,0,0))
receipt.save(root/'Unity/Assets/Resources/QuarryReceipt.png')
seal=Image.new('RGBA',(384,384));d=ImageDraw.Draw(seal)
# Same normalized ore sections as ProspectorOrders.InitOrderFieldMaterials.
# White alpha mask is tinted by the HUD; clear facets retain the two silhouettes.
def assay_points(points):return [(round(u*384),round((1-v)*384)) for u,v in points]
rear=[(.20,.47),(.29,.70),(.47,.74),(.58,.57),(.49,.34),(.31,.30)]
front=[(.46,.37),(.54,.58),(.73,.62),(.82,.45),(.71,.25),(.55,.23)]
d.polygon(assay_points(rear),fill='white')
d.polygon(assay_points(front),fill='white',outline=(0,0,0,0),width=7)
for segment in [[(.29,.70),(.37,.48)],[(.54,.58),(.61,.42),(.82,.45)]]:
 d.line(assay_points(segment),fill=(0,0,0,0),width=5)
d.ellipse((278,47,329,98),outline='white',width=5)
seal.resize((96,96),Image.Resampling.LANCZOS).save(root/'Unity/Assets/Resources/QuarryAssaySeal.png')
