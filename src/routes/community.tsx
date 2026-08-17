import { createFileRoute } from "@tanstack/react-router";
import { Heart, MessageCircle, Send, ShieldAlert, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { requireSupabase } from "@/lib/supabase.client";

export const Route = createFileRoute("/community")({ component: CommunityPage });

type Post = { id:string; user_id:string; reference:string; excerpt:string|null; body:string; created_at:string };
type Like = { post_id:string; user_id:string };
type Comment = { id:string; post_id:string; user_id:string; parent_id:string|null; body:string; created_at:string };

function CommunityPage(){
  const [posts,setPosts]=useState<Post[]>([]);
  const [likes,setLikes]=useState<Like[]>([]);
  const [comments,setComments]=useState<Comment[]>([]);
  const [userId,setUserId]=useState<string | null>(null);
  const [email,setEmail]=useState("");
  const [reference,setReference]=useState("");
  const [excerpt,setExcerpt]=useState("");
  const [body,setBody]=useState("");
  const [replyTo,setReplyTo]=useState<string | null>(null);
  const [replyBody,setReplyBody]=useState("");
  const [message,setMessage]=useState("");

  const load=async()=>{
    const sb=requireSupabase();
    const [{data:p},{data:l},{data:c},{data:{user}}]=await Promise.all([
      sb.from("community_posts").select("id,user_id,reference,excerpt,body,created_at").order("created_at",{ascending:false}).limit(50),
      sb.from("post_likes").select("post_id,user_id"),
      sb.from("comments").select("id,post_id,user_id,parent_id,body,created_at").order("created_at",{ascending:true}),
      sb.auth.getUser(),
    ]);
    setPosts((p??[]) as Post[]);setLikes((l??[]) as Like[]);setComments((c??[]) as Comment[]);setUserId(user?.id??null);
  };
  useEffect(()=>{load().catch(e=>setMessage(e instanceof Error?e.message:"Unable to load community."));const sb=requireSupabase();const {data}=sb.auth.onAuthStateChange(()=>void load());return()=>data.subscription.unsubscribe();},[]);

  const sendMagicLink=async(e:FormEvent)=>{e.preventDefault();const sb=requireSupabase();const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.href}});setMessage(error?error.message:"Check your email for the sign-in link.");};
  const signOut=async()=>{await requireSupabase().auth.signOut();await load();};
  const createPost=async(e:FormEvent)=>{e.preventDefault();if(!userId)return;const cleanExcerpt=excerpt.replace(/\s+/g," ").trim().slice(0,240);const {error}=await requireSupabase().from("community_posts").insert({user_id:userId,reference:reference.trim(),excerpt:cleanExcerpt||null,body:body.trim()});if(error)setMessage(error.message);else{setReference("");setExcerpt("");setBody("");await load();}};
  const toggleLike=async(postId:string)=>{if(!userId)return;const sb=requireSupabase();const liked=likes.some(x=>x.post_id===postId&&x.user_id===userId);const q=liked?sb.from("post_likes").delete().eq("post_id",postId).eq("user_id",userId):sb.from("post_likes").insert({post_id:postId,user_id:userId});const {error}=await q;if(error)setMessage(error.message);else await load();};
  const addComment=async(postId:string,parentId:string|null,text:string)=>{if(!userId||!text.trim())return;const {error}=await requireSupabase().from("comments").insert({post_id:postId,user_id:userId,parent_id:parentId,body:text.trim()});if(error)setMessage(error.message);else{setReplyBody("");setReplyTo(null);await load();}};
  const deletePost=async(id:string)=>{const {error}=await requireSupabase().from("community_posts").delete().eq("id",id);if(error)setMessage(error.message);else await load();};
  const report=async(id:string)=>{if(!userId)return;const reason=window.prompt("Why are you reporting this post?");if(!reason?.trim())return;const {error}=await requireSupabase().from("post_reports").insert({post_id:id,user_id:userId,reason:reason.trim()});setMessage(error?error.message:"Report submitted.");};
  const commentsByPost=useMemo(()=>new Map(posts.map(p=>[p.id,comments.filter(c=>c.post_id===p.id)])),[posts,comments]);

  return <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-28 pt-8">
    <div className="flex items-start justify-between"><div><h1 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Community</h1><p className="mt-1 text-sm text-muted-foreground">Nothing is shared automatically. Posts are always opt-in.</p></div>{userId?<Button size="sm" variant="outline" onClick={signOut}>Sign out</Button>:null}</div>
    {!userId?<Card className="mt-5 p-4"><h2 className="font-medium">Sign in to post, like or comment</h2><p className="mt-1 text-xs text-muted-foreground">Anyone can read the community. Your private notes and highlights never appear here unless you deliberately create a post.</p><form onSubmit={sendMagicLink} className="mt-3 flex gap-2"><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" className="min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"/><Button type="submit">Email link</Button></form></Card>:<Card className="mt-5 p-4"><h2 className="font-medium">Share with community</h2><p className="mt-1 text-xs text-muted-foreground">Use a reference and only a short Scripture excerpt. Your reflection is your own content.</p><form onSubmit={createPost} className="mt-3 space-y-2"><input required value={reference} onChange={e=>setReference(e.target.value)} placeholder="Reference, e.g. Genesis 42:1–5" className="w-full rounded-md border bg-background p-2 text-sm"/><Textarea value={excerpt} onChange={e=>setExcerpt(e.target.value.slice(0,240))} placeholder="Optional short excerpt (max 240 characters)"/><Textarea required value={body} onChange={e=>setBody(e.target.value)} placeholder="Your reflection or question"/><div className="flex justify-between text-xs text-muted-foreground"><span>{excerpt.length}/240 excerpt</span><Button type="submit" size="sm"><Send className="mr-1 size-3.5"/>Post</Button></div></form></Card>}
    {message?<p className="mt-3 rounded-md bg-muted p-2 text-xs">{message}</p>:null}
    <section className="mt-5 space-y-4">{posts.map(post=>{const pcs=commentsByPost.get(post.id)??[];const roots=pcs.filter(c=>!c.parent_id);const likeCount=likes.filter(l=>l.post_id===post.id).length;const liked=userId?likes.some(l=>l.post_id===post.id&&l.user_id===userId):false;return <Card key={post.id} className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-primary">{post.reference}</p><p className="mt-1 text-[10px] text-muted-foreground">{new Date(post.created_at).toLocaleString()}</p></div>{userId===post.user_id?<Button size="icon" variant="ghost" onClick={()=>deletePost(post.id)}><Trash2 className="size-4"/></Button>:userId?<Button size="icon" variant="ghost" onClick={()=>report(post.id)}><ShieldAlert className="size-4"/></Button>:null}</div>{post.excerpt?<p className="mt-3 border-l-2 pl-3 font-[family-name:var(--font-scripture)] text-sm leading-relaxed">“{post.excerpt}”</p>:null}<p className="mt-3 text-sm leading-relaxed">{post.body}</p><div className="mt-3 flex gap-2"><Button size="sm" variant={liked?"default":"outline"} disabled={!userId} onClick={()=>toggleLike(post.id)}><Heart className="mr-1 size-3.5"/>{likeCount}</Button><Button size="sm" variant="outline" disabled={!userId} onClick={()=>setReplyTo(replyTo===post.id?null:post.id)}><MessageCircle className="mr-1 size-3.5"/>{pcs.length}</Button></div>{replyTo===post.id?<div className="mt-3 flex gap-2"><input value={replyBody} onChange={e=>setReplyBody(e.target.value)} placeholder="Write a comment" className="min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"/><Button size="sm" onClick={()=>addComment(post.id,null,replyBody)}>Send</Button></div>:null}<div className="mt-3 space-y-2">{roots.map(c=><CommentTree key={c.id} comment={c} all={pcs} userId={userId} onReply={addComment}/>)}</div></Card>})}</section>
  </main>;
}

function CommentTree({comment,all,userId,onReply}:{comment:Comment;all:Comment[];userId:string|null;onReply:(postId:string,parentId:string|null,text:string)=>Promise<void>}){
  const [open,setOpen]=useState(false);const [text,setText]=useState("");const children=all.filter(c=>c.parent_id===comment.id);
  return <div className="rounded-md bg-muted/60 p-2 text-xs"><p>{comment.body}</p>{userId?<button className="mt-1 text-primary" onClick={()=>setOpen(!open)}>Reply</button>:null}{open?<div className="mt-2 flex gap-1"><input className="min-w-0 flex-1 rounded border bg-background px-2" value={text} onChange={e=>setText(e.target.value)}/><Button size="sm" onClick={async()=>{await onReply(comment.post_id,comment.id,text);setText("");setOpen(false)}}>Reply</Button></div>:null}{children.length?<div className="mt-2 space-y-2 border-l pl-2">{children.map(c=><CommentTree key={c.id} comment={c} all={all} userId={userId} onReply={onReply}/>)}</div>:null}</div>
}
