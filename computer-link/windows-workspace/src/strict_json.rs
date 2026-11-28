//! Reject duplicate decoded keys at every depth, including escaped aliases.
use serde::de::{self,Deserialize,Deserializer,Visitor,MapAccess,SeqAccess};
use serde_json::{Value,Map,Number};
use std::fmt;
struct Unique(Value);
impl<'de> Deserialize<'de> for Unique {
 fn deserialize<D:Deserializer<'de>>(d:D)->Result<Self,D::Error>{
  struct V;
  impl<'de> Visitor<'de> for V {
   type Value=Unique;
   fn expecting(&self,f:&mut fmt::Formatter)->fmt::Result{f.write_str("JSON without duplicate keys")}
   fn visit_bool<E:de::Error>(self,v:bool)->Result<Unique,E>{Ok(Unique(Value::Bool(v)))}
   fn visit_i64<E:de::Error>(self,v:i64)->Result<Unique,E>{Ok(Unique(Value::Number(v.into())))}
   fn visit_u64<E:de::Error>(self,v:u64)->Result<Unique,E>{Ok(Unique(Value::Number(v.into())))}
   fn visit_f64<E:de::Error>(self,v:f64)->Result<Unique,E>{Number::from_f64(v).map(|n|Unique(Value::Number(n))).ok_or_else(||E::custom("nonfinite"))}
   fn visit_str<E:de::Error>(self,v:&str)->Result<Unique,E>{Ok(Unique(Value::String(v.to_owned())))}
   fn visit_string<E:de::Error>(self,v:String)->Result<Unique,E>{Ok(Unique(Value::String(v)))}
   fn visit_unit<E:de::Error>(self)->Result<Unique,E>{Ok(Unique(Value::Null))}
   fn visit_seq<A:SeqAccess<'de>>(self,mut a:A)->Result<Unique,A::Error>{let mut v=Vec::new();while let Some(x)=a.next_element::<Unique>()?{v.push(x.0)}Ok(Unique(Value::Array(v)))}
   fn visit_map<A:MapAccess<'de>>(self,mut a:A)->Result<Unique,A::Error>{let mut m=Map::new();while let Some(k)=a.next_key::<String>()?{if m.contains_key(&k){return Err(de::Error::custom("duplicate JSON key"))}m.insert(k,a.next_value::<Unique>()?.0);}Ok(Unique(Value::Object(m)))}
  }
  d.deserialize_any(V)
 }
}
pub fn parse(bytes:&[u8])->Result<Value,serde_json::Error>{serde_json::from_slice::<Unique>(bytes).map(|v|v.0)}
#[cfg(test)] mod tests{
 use super::*;
 #[test]fn duplicate_keys_refused(){for s in [r#"{"token":"a","token":"b"}"#,r#"{"request":{"op":"read","op":"list"}}"#,r#"{"token":"a","\u0074oken":"b"}"#,r#"[{"a":1,"a":2}]"#]{assert!(parse(s.as_bytes()).is_err())}}
 #[test]fn valid_structure_preserved(){let s=br#"{"token":"x","request":{"op":"read","name":"x"},"test":[true,null,1,-2,1.5]}"#;assert_eq!(parse(s).unwrap(),serde_json::from_slice::<Value>(s).unwrap())}
 #[test]fn malformed_trailing_depth_refused(){assert!(parse(b"{}{}").is_err());assert!(parse(b"{\"x\":").is_err());assert!(parse(format!("{}0{}","[".repeat(140),"]".repeat(140)).as_bytes()).is_err())}
}
