// Built-in presentation types. Values always come from bound knowledge or explicit props.
export const blockCatalog=[
 ['tldr','要点','阅读'],['kpi','指标','数据'],['compare','对比','分析'],['timeline','时间线','阅读'],
 ['claim','观点与引用','阅读'],['proscons','利弊','分析'],['matrix','矩阵','分析'],['rank','排序','数据'],
 ['heatmap','热力表','数据'],['graph','关系图','关系'],['quote','摘录','阅读'],['agree','观点汇集','关系'],
 ['ladder','递进','分析'],['funnel','漏斗','数据'],['diff','差异','分析'],['terms','术语','阅读']
].map(([type,title,category])=>({type,title,category}));
export const builtinTypes=['markdown','metric','table','cards','chart','tasks','timeline','relations','media',...blockCatalog.map(x=>x.type)];
