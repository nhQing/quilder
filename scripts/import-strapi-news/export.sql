\pset format unaligned
\pset tuples_only on
\pset pager off
with
bl as (
  select b.*,
    (select team_id from blogs_createdby_links l where l.blog_id=b.id limit 1) team_id,
    (select m.file_id from files_related_morphs m where m.related_type='api::blog.blog' and m.related_id=b.id and m.field='thumbnail' order by m."order" limit 1) thumb_file,
    (select m.file_id from files_related_morphs m where m.related_type='api::blog.blog' and m.related_id=b.id and m.field='image' order by m."order" limit 1) image_file,
    (select s.id from blogs_components c join components_shared_seos s on s.id=c.component_id where c.entity_id=b.id and c.field='seo' limit 1) seo_id
  from blogs b
),
seo as (
  select s.*, (select m.file_id from files_related_morphs m where m.related_type='shared.seo' and m.related_id=s.id and m.field='metaImage' limit 1) meta_file from components_shared_seos s
),
body_urls as (
  select distinct (regexp_matches(body, 'https://cdn\.maimoney\.com/[^"'' )<>&]+', 'g'))[1] url from blogs
),
need_files as (
  select thumb_file id from bl where thumb_file is not null
  union select image_file from bl where image_file is not null
  union select seo.meta_file from seo where seo.id in (select seo_id from bl) and meta_file is not null
  union select f.id from files f join body_urls u on u.url=f.url
  union select m.file_id from files_related_morphs m where m.related_type='api::team.team' and m.field='avatar' and m.related_id in (select team_id from bl where team_id is not null)
)
select json_build_object(
 'blogs', (select json_agg(json_build_object(
    'id',b.id,'locale',b.locale,'title',b.title,'slug',b.slug,'description',b.description,'body',b.body,
    'created_at',to_char(b.created_at,'YYYY-MM-DD HH24:MI:SS.US'),
    'updated_at',to_char(b.updated_at,'YYYY-MM-DD HH24:MI:SS.US'),
    'published_at',to_char(b.published_at,'YYYY-MM-DD HH24:MI:SS.US'),
    'external_link',b.external_link,'event',b.event,'team_id',b.team_id,
    'thumb_file',b.thumb_file,'image_file',b.image_file,
    'seo', (select json_build_object('meta_title',s.meta_title,'meta_description',s.meta_description,'keywords',s.keywords,'meta_file',s.meta_file) from seo s where s.id=b.seo_id),
    'cats',(select coalesce(json_agg(c.slug order by c.id),'[]'::json) from blogs_category_links l join categories c on c.id=l.category_id where l.blog_id=b.id),
    'groups',(select coalesce(json_agg(g.slug order by g.id),'[]'::json) from blogs_group_links l join blog_groups g on g.id=l.blog_group_id where l.blog_id=b.id)
  ) order by b.id) from bl b),
 'pairs', (select json_agg(json_build_object('vi',v.id,'en',e.id)) from blogs_localizations_links l join blogs v on v.id=l.blog_id and v.locale='vi' join blogs e on e.id=l.inv_blog_id and e.locale='en'),
 'files', (select json_agg(json_build_object('id',f.id,'name',f.name,'alt',f.alternative_text,'width',f.width,'height',f.height,'mime',f.mime,'size_kb',f.size,'url',f.url,'folder_path',f.folder_path,
    'created_at',to_char(f.created_at,'YYYY-MM-DD HH24:MI:SS.US')) order by f.id) from files f where f.id in (select id from need_files)),
 'folders', (select json_agg(json_build_object('path',path,'name',name) order by path) from upload_folders),
 'teams', (select json_agg(json_build_object('id',t.id,'name',t.name,'locale',t.locale,
     'avatar_file',(select m.file_id from files_related_morphs m where m.related_type='api::team.team' and m.field='avatar' and m.related_id=t.id limit 1)))
     from teams t where t.id in (select team_id from bl where team_id is not null))
);
