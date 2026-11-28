use serde_json::Value;
use std::io::{self, Read, Write};

// Below the browser's 1 MiB native-message limit, while allowing the complete
// bounded session/history snapshot including immutable incident identities.
pub const MAX_FRAME: usize = 1_000_000;

pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Value>> {
    let mut length = [0_u8; 4];
    loop {
        match reader.read(&mut length[..1]) {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    reader.read_exact(&mut length[1..])?;
    let length = u32::from_ne_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame size",
        ));
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes)?;
    let message: Value = serde_json::from_slice(&bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid JSON frame"))?;
    if !message.is_object() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame must be an object",
        ));
    }
    Ok(Some(message))
}

pub fn write_frame(writer: &mut impl Write, message: &Value) -> io::Result<()> {
    let bytes = serde_json::to_vec(message)?;
    if bytes.is_empty() || bytes.len() > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "outgoing frame too large",
        ));
    }
    writer.write_all(&(bytes.len() as u32).to_ne_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;

    struct Fragmented(Cursor<Vec<u8>>);
    impl Read for Fragmented {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            let count = bytes.len().min(2);
            self.0.read(&mut bytes[..count])
        }
    }

    #[test]
    fn partial_reads_unicode_and_multiple_messages() {
        let mut bytes = Vec::new();
        let message = json!({"id":"猫","v":1,"op":"snapshot"});
        write_frame(&mut bytes, &message).unwrap();
        write_frame(&mut bytes, &message).unwrap();
        let mut reader = Fragmented(Cursor::new(bytes));
        assert_eq!(read_frame(&mut reader).unwrap(), Some(message.clone()));
        assert_eq!(read_frame(&mut reader).unwrap(), Some(message));
        assert!(read_frame(&mut reader).unwrap().is_none());
    }

    #[test]
    fn rejects_oversize_truncated_and_non_object_frames() {
        assert!(read_frame(&mut Cursor::new(u32::MAX.to_ne_bytes())).is_err());
        assert!(read_frame(&mut Cursor::new(vec![1, 2])).is_err());
        assert!(
            read_frame(&mut Cursor::new(
                [2_u32.to_ne_bytes().as_slice(), b"[]"].concat()
            ))
            .is_err()
        );
        assert!(
            read_frame(&mut Cursor::new(
                [5_u32.to_ne_bytes().as_slice(), b"{}"].concat()
            ))
            .is_err()
        );
    }
}
