"""Read document structure with HTMLParser, ignoring scripts/comments (not regex HTML)."""
import json, sys
from html.parser import HTMLParser
class Facts(HTMLParser):
    def __init__(self):
        super().__init__(); self.phases=[]; self.links=[]
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='article' and 'phase-card' in a.get('class','').split():
            self.phases.append({'num':a.get('data-phase'), 'status':a.get('data-status')})
        if tag in ('a','link','script','img'):
            value=a.get('href') or a.get('src')
            if value: self.links.append(value)
result=[]
for source in json.load(sys.stdin):
    p=Facts();p.feed(source);result.append({'phases':p.phases,'links':p.links})
json.dump(result,sys.stdout)
