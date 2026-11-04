"""Build a bounded machine-assessed batch from reviewed source notes."""
import json
from pathlib import Path
P=Path(__file__).parent
research=json.loads((P/'candidates.json').read_text())
selected={
'DNB':dict(country='NO',industry='finance_insurance',impact='ai_cost_cutting_layoff',date='2026-10-06',count=400,pct=None,
summary='On October 6, 2026, DNB announced an approximately 400-FTE reduction in Technology & Services, planned for Q4 2026. The bank links the restructuring to agentic AI taking over manual tasks, process simplification and a changed skills mix. This records the announced plan, not independently verified completed dismissals.',
country_url='https://ir.dnb.no/about-dnb/dnb-brief',country_note='Official DNB in brief identifies a Norwegian financial services group; the event release footer identifies DNB Bank ASA and Oslo.'),
'Snap':dict(country='US',industry='other',impact='ai_cost_cutting_layoff',date='2026-04-15',count=1000,pct=16,
summary='On April 15, 2026, Snap announced changes affecting approximately 1,000 team members, including 16% of full-time employees, and separately closed over 300 vacancies. Its CEO cited AI-enabled reductions in repetitive work alongside investment prioritization and a path to profitability. The stated cuts are announced changes, not a verified completed total.',
country_url='https://www.sec.gov/Archives/edgar/data/1564408/000119312526155861/d36756d8k.htm',country_note='Original 8-K gives Delaware incorporation and Santa Monica, California executive offices. Industry other avoids inventing a social-media category absent from the enum.'),
'Freshworks':dict(country='US',industry='software_saas',impact='ai_cost_cutting_layoff',date='2026-05-05',count=500,pct=11,
summary='On May 5, 2026, Freshworks announced a restructuring plan expected to affect approximately 500 employees, or 11% of its global workforce. Its 8-K links the plan to organizational and product-development streamlining and increased use of AI and automation. Substantial completion was expected by June 30; completion is not independently verified here.',
country_url='https://www.sec.gov/Archives/edgar/data/1544522/000154452226000088/frsh-20260505.htm',country_note='Original 8-K identifies Delaware incorporation and San Mateo, California executive offices. CEO company message describes Freshworks software products and customer/employee experience business.'),
'FICO':dict(country='US',industry='finance_insurance',impact='ai_cost_cutting_layoff',date='2026-10-01',count=None,pct=15,
summary='Fair Isaac committed on October 1, 2026 to eliminate approximately 15% of positions, with notifications beginning the week of October 5. Its October 6 filing cites fewer organizational layers, process and tool optimization, and AI-driven product development. Completion was expected by fiscal Q3 2027; the filing gives no absolute job count.',
country_url='https://investors.fico.com/node/30041/html',country_note='Original 8-K identifies Delaware incorporation and Bozeman, Montana executive offices. Credit-scoring company is classified in finance/insurance; no unsupported exact employment estimate is used.')
}
batch={'schema_version':1,'batch_id':'historical-backfill-2026-11-04-v1','research_date':'2026-11-04','scope':'Bounded local backfill; machine assessment is not human verification. Importer must fetch source and apply current gates.','candidates':[]}
for c in research['candidates']:
 if c['name'] not in selected:
  batch['candidates'].append({'id':c['id']+':'+(c['confirmed']['event_date'] or 'date-unresolved'),'research_candidate_id':c['id'],'deferred_reason':'Full ingestion fields or attribution review not completed in this bounded backfill; retain research-only status.','research_status':c['status']})
  continue
 r=selected[c['name']];s=c['evidence'][0]
 source={'url':s['url'],'mediaName':s['publisher'],'sourceType':'primary_company','publishedAt':s['published_at'],'title':s['title'],'author':None,'quote':s['short_quote'],'quoteLang':s['quote_language'],'quoteTranslationZh':None,'archiveUrl':None,'linkHealth':'ok','manuallyVerified':False}
 record={'company':{'slug':c['id'],'name':c['legal_identity'],'nameZh':None,'aliases':c['aliases'],'countryCode':r['country'],'industry':r['industry'],'companySize':'unknown','foundedYear':None,'websiteUrl':None,'description':None,'logoUrl':None},'impact':{'impactType':r['impact'],'attributionConfidence':'medium','outcome':'downsizing_announced','eventDate':r['date'],'eventDatePrecision':'day','summary':r['summary'],'summaryEn':r['summary'],'employeesAffected':r['count'],'employeesAffectedPct':r['pct'],'revenueImpactNote':None,'isPrimary':True,'counterEvidence':c['notes'][0]+' Single company-origin account; independently demonstrated causal allocation to AI and completed reductions are not established.','reviewNote':'Machine assessment only. Event date denotes plan commitment or announcement, never verified completion.'},'sources':[source],'status':'draft'}
 candidate={'id':c['id']+':'+r['date'],'research_candidate_id':c['id'],'record':record,'assessment':{'method':'machine','model':'GPT-6 (Codex research agent)','policyVersion':'historical-backfill-v1','rationale':'The company-origin document explicitly connects a quantified workforce plan with AI-related operational or development changes. Medium attribution preserves the single-origin evidence limit and multiple stated drivers; no human review is claimed.','evidenceUrls':[source['url']],'independenceGroups':{source['url']:c['id']+'-company-origin'}},'field_evidence':{'countryCode':{'url':r['country_url'],'notes':r['country_note']},'eventDate':{'url':source['url'],'meaning':'plan commitment date' if c['name']=='FICO' else 'announcement date'},'industry':{'notes':r['country_note']},'source_publication_date':{'url':source['url'],'value':source['publishedAt']}},'retrieval_evidence':'Not fabricated; importer must generate it by live retrieval.'}
 batch['candidates'].append(candidate)
# Make announcement/commitment semantics explicit throughout the original notes.
for c in research['candidates']:
 c['confirmed']['event_date_semantics']='reported_event_date_not_completed_reduction_date'
 if c['name']=='Agora':
  c['confirmed']['event_date_semantics']='initial_restructuring_announcement_date'
  chronology='Chronology: initial stock-exchange announcement December 30, 2025; agreement January 19, 2026; planned completion February 28, 2026. The event_date is the first announcement, not the agreement or verified completion.'
  if chronology not in c['notes']: c['notes'].append(chronology)
 if c['name']=='FICO': c['confirmed']['event_date_semantics']='plan_commitment_date_not_filing_or_completion_date'
 if c['name'] in selected:
  c['backfill_record_id']=c['id']+':'+selected[c['name']]['date']
batch['counts']={'candidates':len(batch['candidates']),'complete_records':len(selected),'deferred_without_record':len(batch['candidates'])-len(selected),'human_verified':0,'completed_outcomes_verified':0}
(P/'historical-backfill.json').write_text(json.dumps(batch,indent=2,ensure_ascii=False)+'\n')
(P/'candidates.json').write_text(json.dumps(research,indent=2,ensure_ascii=False)+'\n')
print(batch['counts'])
