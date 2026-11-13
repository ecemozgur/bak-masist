import re
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models import Machine, MaintenanceLog, ChatMessage

class ChatbotService:
    """
    Bakım teknisyenleri için akıllı yapay zeka arıza asistanı.
    Makinelerin geçmiş arızalarını, çözümlerini ve parça kayıtlarını tarayarak
    sahadaki teknisyene nokta atışı yol gösterir.
    """

    @classmethod
    def answer_query(cls, db: Session, query: str, machine_code: Optional[str] = None, user_id: Optional[int] = None) -> Dict[str, Any]:
        q_lower = query.lower()

        # 1. Makine Kodu Belirlenmemişse Metinden Çıkar
        target_machine = None
        if machine_code:
            target_machine = db.query(Machine).filter(Machine.code == machine_code).first()

        if not target_machine:
            machines = db.query(Machine).all()
            for m in machines:
                normalized = m.code.lower().replace("-", " ")
                if normalized in q_lower or m.code.lower() in q_lower:
                    target_machine = m
                    break

        # 2. İlgili Arıza Kayıtlarını Tara (Geçmiş Bilgi Tabanı)
        logs_query = db.query(MaintenanceLog)
        if target_machine:
            logs_query = logs_query.filter(MaintenanceLog.machine_id == target_machine.id)

        # Anahtar kelimeler ile geçmiş kayıtları filtrele
        keywords = [word for word in re.findall(r'\w+', q_lower) if len(word) > 3 and word not in ["hata", "arıza", "nedir", "nasıl", "daha", "önce", "hangi", "yaptık"]]
        
        relevant_logs = []
        if keywords:
            conditions = []
            for kw in keywords:
                conditions.append(MaintenanceLog.failure_description.ilike(f"%{kw}%"))
                conditions.append(MaintenanceLog.action_taken.ilike(f"%{kw}%"))
                conditions.append(MaintenanceLog.parts_replaced.ilike(f"%{kw}%"))
            logs_query = logs_query.filter(or_(*conditions))
            relevant_logs = logs_query.order_by(MaintenanceLog.id.desc()).limit(5).all()

        if not relevant_logs and target_machine:
            # Genel makine son 5 kaydını al
            relevant_logs = db.query(MaintenanceLog).filter(
                MaintenanceLog.machine_id == target_machine.id
            ).order_by(MaintenanceLog.id.desc()).limit(5).all()

        # 3. Akıllı Yanıt Oluşturma (RAG / AI Synthesis)
        answer_parts = []
        ref_data = []

        if target_machine:
            answer_parts.append(f"🤖 **Makine Odaklı Analiz: {target_machine.code} ({target_machine.name})**")
            answer_parts.append(f"• **Durum:** {target_machine.status} | **Toplam Duruş:** {target_machine.total_downtime_minutes} dk")
        else:
            answer_parts.append("🤖 **Fabrika Genel Bakım Arşivi Taraması:**")

        if relevant_logs:
            answer_parts.append("\n📌 **Geçmişte Karşılaşılan Benzer Kayıtlar & Çözümleri:**")
            for idx, log in enumerate(relevant_logs, 1):
                m_code = log.machine.code if log.machine else "Genel"
                answer_parts.append(
                    f"\n**{idx}. Kayıt ({log.date_str} - {m_code}):**\n"
                    f"• **Belirti / Arıza:** {log.failure_description}\n"
                    f"• **Yapılan Çözüm:** {log.action_taken}\n"
                    f"• **Değişen Parça:** {log.parts_replaced}\n"
                    f"• **Kök Neden / Kaynak:** {log.source}"
                )
                ref_data.append({
                    "id": log.id,
                    "date": log.date_str,
                    "machine": m_code,
                    "action": log.action_taken,
                    "parts": log.parts_replaced
                })

            # Tavsiye & Adımlar
            answer_parts.append("\n💡 **Önerilen Müdahale Adımları:**")
            if any("hidrolik" in l.failure_description.lower() or "basınç" in l.failure_description.lower() for l in relevant_logs):
                answer_parts.append("1. Hidrolik tank seviyesini ve filtre tıkanıklık göstergesini kontrol edin.")
                answer_parts.append("2. Emniyet valfi ve basınç regülatörünün kalibrasyonunu test edin.")
                answer_parts.append("3. Hortum ve rakor bağlantılarında mikro sızıntı olup olmadığını gözlemleyin.")
            elif any("rulman" in l.failure_description.lower() or "ses" in l.failure_description.lower() for l in relevant_logs):
                answer_parts.append("1. Yatak sıcaklığını lazer termometre ile ölçün.")
                answer_parts.append("2. Otomatik veya manuel gres yağlama kanalının tıkalı olmadığını doğrulayın.")
                answer_parts.append("3. Boşluk kontrolü yaparak aşınma varsa rulman değişimine hazırlanın.")
            elif any("termik" in l.failure_description.lower() or "sigorta" in l.failure_description.lower() for l in relevant_logs):
                answer_parts.append("1. Pano içerisindeki motor akımını pensampermetre ile ölçün.")
                answer_parts.append("2. Mekanik sıkışma veya faz kaybı olup olmadığını teyit edin.")
            else:
                answer_parts.append("1. Öncelikle makine kontrol panelindeki alarm kodunu inceleyin.")
                answer_parts.append("2. Yukarıda listelenen geçmiş çözüm adımlarını sırasıyla uygulayın.")
                answer_parts.append("3. Müdahale bittiğinde bu ekrandan sesinizle veya Doruk'a çözümü kaydetmeyi unutmayın.")
        else:
            answer_parts.append(
                "\nBu arıza veya arama terimiyle ilgili geçmişte doğrudan eşleşen bir kayıt bulunamadı.\n"
                "• Öneri: Makinenin kullanım kılavuzunu inceleyebilir, elektriksel ve mekanik kontrolleri güvenlik protokollerine uygun şekilde başlatabilirsiniz.\n"
                "• Çözüme ulaştığınızda sisteme sesle kaydederseniz, gelecekteki arızalarda diğer bakımcılara rehber olacaktır."
            )

        full_answer = "\n".join(answer_parts)

        # Mesajı veritabanına kaydet
        user_msg = ChatMessage(
            user_id=user_id,
            machine_id=target_machine.id if target_machine else None,
            sender="USER",
            message=query
        )
        bot_msg = ChatMessage(
            user_id=user_id,
            machine_id=target_machine.id if target_machine else None,
            sender="ASSISTANT",
            message=full_answer,
            context_used=str(ref_data)
        )
        db.add(user_msg)
        db.add(bot_msg)
        db.commit()

        return {
            "answer": full_answer,
            "machine_code": target_machine.code if target_machine else None,
            "referenced_logs": ref_data
        }
